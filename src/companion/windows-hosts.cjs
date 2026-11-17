const path=require('node:path'),fs=require('node:fs/promises'),{execFile,spawn}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile);
const {createJsonLines}=require('../json-lines.cjs');
function createWindowsHosts({paths,startupMark,pwshPath=process.env.MIKU_PWSH||'pwsh',exec=run,spawnProcess=spawn,clock={setTimeout,clearTimeout}}){
 const script=name=>path.resolve(__dirname,'../../scripts',name);let child,closed=false,restartTimer=null,watching=false,watchClosed=false,failures=0,initialWait;const cosmeticsAbort=new AbortController();
 function finishInitial(){
  if(!initialWait)return;
  clock.clearTimeout(initialWait.timer);
  initialWait.resolve();
  initialWait=null;
 }
 function stopWatch(){watchClosed=true;finishInitial();clock.clearTimeout(restartTimer);restartTimer=null;const old=child;child=null;old?.kill()}
 async function invoke(args,{signal}={}){const result=await exec(pwshPath,['-NoProfile','-File',...args],{windowsHide:true,timeout:60000,maxBuffer:1024*1024,signal});return JSON.parse(result.stdout.replace(/^\uFEFF/,''))}
 return {
  async scan(){const value=await invoke([script('companion-hosts.ps1'),'-Operation','Scan']);if(!Array.isArray(value))throw new Error('Invalid host inventory');startupMark?.('hostInventoryMs');return value},
  watch(onEvent,{waitForInventory=false}={}){
   if(closed||watching)throw new Error('Host monitor closed or already running');watching=true;
   const initial=waitForInventory?new Promise(resolve=>{initialWait={resolve,timer:clock.setTimeout(finishInitial,8000)}}):undefined;
   const restart=mine=>{if(closed||watchClosed||child!==mine||restartTimer!==null)return;child=null;mine.kill();finishInitial();onEvent({type:'error',code:'HOST_NOT_FOUND'});const ms=Math.min(30000,250*2**Math.min(failures++,7));restartTimer=clock.setTimeout(()=>{restartTimer=null;if(!closed&&!watchClosed)start()},ms)};
   const start=()=>{
    const mine=spawnProcess(pwshPath,['-NoProfile','-File',script('companion-hosts.ps1'),'-Operation','Watch'],{windowsHide:true,stdio:['ignore','pipe','ignore']});child=mine;let lastInventory=null;
    const receive=createJsonLines({maxLength:1024*1024,onOverflow:()=>restart(mine),onValue:event=>{
     if(child!==mine||closed||watchClosed||event?.type!=='hosts'||!Array.isArray(event.hosts))return;
     failures=0;
     if(initialWait){startupMark?.('hostInventoryMs');finishInitial()}
     const key=JSON.stringify(event.hosts);
     if(key!==lastInventory){lastInventory=key;onEvent(event)}
    }});
    mine.stdout.setEncoding('utf8');mine.stdout.on('data',chunk=>{if(child===mine&&!closed&&!watchClosed)receive(chunk)});
    mine.on('error',()=>restart(mine));mine.on('exit',()=>restart(mine));
   };start();return {close:stopWatch,initial};
  },
  async launch(hostId,{generation=1,signal,allowStart=false}={}){
   if(hostId!=='codex-desktop')throw Object.assign(new Error('Unsupported host'),{code:'HOST_TRANSPORT_UNAVAILABLE'});signal?.throwIfAborted();
   const args=[script('companion-launch-host.ps1'),'-HostId',hostId,'-StateRoot',path.join(paths.runtime,'hosts'),'-Generation',String(generation)];
   if(!allowStart)args.push('-ConnectOnly');
   const result=await invoke(args,{signal});signal?.throwIfAborted();
   if(!result.ok)throw Object.assign(new Error(result.error?.message||'Host launch failed'),{code:result.error?.code||'HOST_LAUNCH_FAILED'});
   startupMark?.('hostSessionMs');
   // The clicked launcher restores the native window. Cosmetic grouping has its
   // own fresh identity check and must not block connection or steal focus.
   if(!closed&&typeof result.session?.runDirectory==='string')void invoke([script('codex-taskbar-identity.ps1'),'-IdentityPath',path.join(result.session.runDirectory,'session.json'),'-Action','Apply'],{signal:cosmeticsAbort.signal}).catch(()=>{});
   return result.session;
  },
  async activate(session){const file=path.join(session.runDirectory,'session.json'),saved=JSON.parse(await fs.readFile(file,'utf8'));if(saved.pid!==session.pid||saved.startTime!==session.startTime||saved.sessionId!==session.sessionId)throw Object.assign(new Error('Session changed'),{code:'HOST_IDENTITY_CHANGED'});/* Show performs the fresh native process/port verification. */await invoke([script('windows-session.ps1'),'-Operation','Show','-IdentityPath',file])},
  async verify(session){const file=path.join(session.runDirectory,'session.json');const saved=JSON.parse(await fs.readFile(file,'utf8'));if(saved.pid!==session.pid||saved.startTime!==session.startTime||saved.sessionId!==session.sessionId)throw Object.assign(new Error('Session changed'),{code:'HOST_IDENTITY_CHANGED'});await exec(pwshPath,['-NoProfile','-File',script('windows-session.ps1'),'-Operation','Verify','-IdentityPath',file],{windowsHide:true,timeout:15000});return true},
  close(){closed=true;cosmeticsAbort.abort();stopWatch()}
 };
}
module.exports={createWindowsHosts};
