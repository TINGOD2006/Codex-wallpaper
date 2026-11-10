const fs=require('node:fs/promises'),path=require('node:path'),{spawn,execFile}=require('node:child_process'),{promisify}=require('node:util'),{randomUUID}=require('node:crypto');
const {atomicJson}=require('../config.cjs'),{delay}=require('../control.cjs'),{validateSocket,connectSocket,connectOwnedPage}=require('./owned-endpoint.cjs'),{renderError,checkAbort}=require('./errors.cjs');
const run=promisify(execFile),marker={owner:'codex-wallpaper-renderer-pool',schemaVersion:1};
async function invoke(operation,identity){try{const {stdout}=await run(process.env.MIKU_PWSH||'pwsh',['-NoProfile','-File',path.resolve(__dirname,'../../scripts/renderer-process.ps1'),'-Operation',operation,'-ProcessId',String(identity.pid),'-ExpectedExecutable',identity.executable,'-ProfilePath',identity.profile,...(identity.startTime?['-StartTime',identity.startTime]:[]),...(identity.port?['-Port',String(identity.port)]:[])],{windowsHide:true,timeout:15000,maxBuffer:65536});return JSON.parse(stdout.replace(/^\uFEFF/,''))}catch(error){throw renderError(String(error.stderr).includes('OWNER_MISMATCH')?'OWNER_MISMATCH':'POOL_UNAVAILABLE',error)}}
async function ownProfile(paths){
 const root=path.join(paths.runtime,'renderer-pool'),profile=path.join(root,'profile');await fs.mkdir(root,{recursive:true});const realRoot=await fs.realpath(root),runtime=await fs.realpath(paths.runtime);if(!realRoot.startsWith(runtime+path.sep)||(await fs.lstat(root)).isSymbolicLink())throw renderError('OWNER_MISMATCH');
 try{const stat=await fs.lstat(profile);if(!stat.isDirectory()||stat.isSymbolicLink())throw renderError('OWNER_MISMATCH');const saved=JSON.parse(await fs.readFile(path.join(profile,'codex-owner.json'),'utf8'));if(saved.owner!==marker.owner||saved.schemaVersion!==marker.schemaVersion)throw renderError('OWNER_MISMATCH')}
 catch(error){if(error.code!=='ENOENT')throw error instanceof SyntaxError?renderError('OWNER_MISMATCH',error):error;try{await fs.mkdir(profile)}catch(e){if(e.code==='EEXIST')throw renderError('OWNER_MISMATCH');throw e}await fs.writeFile(path.join(profile,'codex-owner.json'),JSON.stringify(marker),{flag:'wx'})}
 return {root,profile};
}
async function defaultBrowserFactory({paths}){
 const {root,profile}=await ownProfile(paths);let executable;
 for(const file of [path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe'),path.join(process.env.ProgramFiles||'C:/Program Files','Microsoft/Edge/Application/msedge.exe')])try{await fs.access(file);executable=file;break}catch{}
 if(!executable)throw renderError('POOL_UNAVAILABLE');
 const child=spawn(executable,['--headless=new','--no-startup-window','--edge-skip-compat-layer-relaunch','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--autoplay-policy=no-user-gesture-required','--window-size=800,600','about:blank'],{windowsHide:true,stdio:'ignore'});let spawnError;child.on('error',e=>{spawnError=e});
 let identity,client;
 // The endpoint/PID tuple is verified before opening the root WebSocket. While
 // that socket remains connected it cannot migrate to a reused PID. Target
 // operations use that continuity proof; process shutdown rechecks the full
 // process/profile tuple. Forced termination always verifies it in Windows.
 const verify=async({continuity=false}={})=>{if(continuity){if(!client?.connected)throw renderError('POOL_LOST');return true}await invoke('Verify',{...identity,port:0});return true};
 const waitForExit=async()=>{for(let i=0;i<30;i++){if(child.exitCode!==null||child.signalCode)return true;await delay(100)}return false};
 try{
  if(!child.pid)throw renderError('POOL_UNAVAILABLE',spawnError);identity=await invoke('Stamp',{pid:child.pid,executable,profile});
  for(let i=0;i<100;i++){
   if(spawnError)throw renderError('POOL_UNAVAILABLE',spawnError);if(child.exitCode!==null)throw renderError('POOL_PROFILE_BUSY');
   try{const [portText]=String(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n'),port=Number(portText);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Port not ready');const candidate={...identity,port};await invoke('Verify',candidate);identity=candidate;break}catch(error){if(error.code==='OWNER_MISMATCH'&&i===99)throw error;await delay(100)}
  }
  // The successful candidate check just verified PID, creation time, profile
  // and listener together. Repeating a process-only check here adds a shell
  // startup without strengthening that proof; establish socket continuity now.
  if(!identity.port)throw renderError('POOL_UNAVAILABLE');const version=await (await fetch(`http://127.0.0.1:${identity.port}/json/version`,{signal:AbortSignal.timeout(3000)})).json();const socket=validateSocket(version.webSocketDebuggerUrl,identity.port,/^\/devtools\/browser\/[\w-]+$/);client=await connectSocket(socket);await atomicJson(path.join(root,'browser.json'),{...identity,instance:randomUUID()});
  return {identity,client,verify,waitForExit,terminate:()=>invoke('Stop',{...identity,port:0})};
 }catch(error){client?.close();if(identity){try{await invoke('Stop',{...identity,port:0});await waitForExit()}catch{}}if(!identity&&(child.exitCode!==null||child.signalCode))throw renderError('POOL_PROFILE_BUSY',error);throw error}
}
function createBrowserOwner({paths,browserFactory=defaultBrowserFactory,connectPage=connectOwnedPage}){
 let browser,starting,stopping,closed=false,generation=0,version=null,tail=Promise.resolve(),expected=false;const targets=new Map(),listeners=new Set(),retired=new Set();let rootListener;
 const serial=work=>{const next=tail.then(work);tail=next.catch(()=>{});return next};
 async function drainRetired(){for(const old of retired){if(await old.waitForExit()!==true){await old.terminate();if(await old.waitForExit()===false)throw renderError('POOL_LOST')}old.client.close();retired.delete(old)}}
 async function start(){if(closed)throw renderError('POOL_CLOSED');if(stopping)await stopping;if(browser?.client.connected)return {browserGeneration:generation,browserVersion:version};if(starting)return starting;
  starting=(async()=>{await drainRetired();if(closed)throw renderError('POOL_CLOSED');const candidate=await browserFactory({paths});try{if(closed)throw renderError('POOL_CLOSED');const info=await candidate.client.send('Browser.getVersion');if(!candidate.client.connected)throw renderError('POOL_LOST');browser=candidate;generation++;expected=false;const mine=candidate;rootListener=()=>{if(browser!==mine)return;browser=null;retired.add(mine);for(const target of targets.values())target.client?.close();targets.clear();for(const listener of listeners)try{listener({expected,browserGeneration:generation})}catch{}};candidate.client.on('disconnected',rootListener);version=info.product;return {browserGeneration:generation,browserVersion:version}}catch(error){candidate.client.close();await candidate.terminate();await candidate.waitForExit();throw error}})();try{return await starting}finally{starting=null}
 }
 async function closePage(target){if(target.closed)return;target.closed=true;target.client?.close();if(targets.get(target.targetId)!==target)return;targets.delete(target.targetId);const current=browser;if(!current?.client.connected)return;if(!await current.verify({continuity:true}))throw renderError('OWNER_MISMATCH');await current.client.send('Target.closeTarget',{targetId:target.targetId})}
 function openTarget({url,width,height,signal,role='content'}){return serial(async()=>{checkAbort(signal);await start();checkAbort(signal);const u=new URL(url);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.username||u.password||u.hash||!['content','control'].includes(role)||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>1920||height>1080)throw renderError('OWNER_MISMATCH');const cap=role==='content'?2:1;if([...targets.values()].filter(t=>t.role===role).length>=cap)throw renderError('POOL_UNAVAILABLE');const current=browser;if(!await current.verify({continuity:true}))throw renderError('OWNER_MISMATCH');let targetId;
   if(role==='control'){const {targetInfos=[]}=await current.client.send('Target.getTargets');const blank=targetInfos.filter(t=>t.type==='page'&&t.url==='about:blank'&&!targets.has(t.targetId));if(blank.length===1)targetId=blank[0].targetId}
   if(!targetId)({targetId}=await current.client.send('Target.createTarget',{url,width,height,newWindow:true,background:false}));
   const target={targetId,role,closed:false};targets.set(targetId,target);
   try{
    if(role==='control'){const aboutBlank=await connectPage(current.identity,targetId,'about:blank').catch(()=>null);if(aboutBlank){await aboutBlank.send('Page.navigate',{url});aboutBlank.close()}}
    checkAbort(signal);target.client=await connectPage(current.identity,targetId,url);if(browser!==current||closed)throw renderError('POOL_LOST');checkAbort(signal);return {targetId,client:target.client,close:()=>closePage(target)};
   }catch(error){await closePage(target).catch(()=>{});throw error}
  })}
 async function stop(){if(stopping)return stopping;stopping=(async()=>{if(starting)await starting.catch(()=>{});const current=browser;if(!current){await drainRetired();return}expected=true;if(!await current.verify())throw renderError('OWNER_MISMATCH');await Promise.allSettled([...targets.values()].map(target=>closePage(target)));current.client.off('disconnected',rootListener);await current.client.send('Browser.close').catch(()=>{});current.client.close();if(!await current.waitForExit()){await current.terminate();if(await current.waitForExit()===false)throw renderError('POOL_LOST')}retired.delete(current);if(browser===current)browser=null;await drainRetired()})().finally(()=>{stopping=null});return stopping}
 return {start,openTarget,stop,onLost(listener){listeners.add(listener);return()=>listeners.delete(listener)},snapshot(){return {browserGeneration:generation,browserVersion:version,connected:!!browser?.client.connected,contentTargets:[...targets.values()].filter(t=>t.role==='content').length,controlTargets:[...targets.values()].filter(t=>t.role==='control').length}},async close(){closed=true;await tail;await stop();listeners.clear()}};
}
module.exports={createBrowserOwner,defaultBrowserFactory};
