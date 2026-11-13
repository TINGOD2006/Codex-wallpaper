const path=require('node:path'),fs=require('node:fs/promises'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const {loadConfig,saveConfig,readJson}=require('./config.cjs'),{Protocol,selectTarget}=require('./protocol.cjs'),{sendCommand}=require('./control.cjs');
const run=promisify(execFile),project=path.resolve(__dirname,'..'),stateRoot=path.join(project,'.state'),identityPath=path.join(stateRoot,'session.json'),configPath=path.join(project,'config.json'),statusPath=path.join(stateRoot,'status.json');
function alive(pid){try{process.kill(pid,0);return true}catch(error){return error.code==='EPERM'}}
async function verifyIdentity(file,signal){await run(process.env.MIKU_PWSH||'pwsh',['-NoProfile','-File',path.join(project,'scripts/windows-session.ps1'),'-Operation','Verify','-IdentityPath',file],{windowsHide:true,timeout:12000,maxBuffer:65536,signal})}
async function connectManaged(file,{signal}={}){
 signal?.throwIfAborted();const identity=await readJson(file);if(!Number.isInteger(identity.port)||identity.port<1||identity.port>65535)throw new Error('Invalid managed port');await verifyIdentity(file,signal);
 const deadline=AbortSignal.timeout(5000),targetSignal=signal?AbortSignal.any([signal,deadline]):deadline;
 let targets;
 try{
  const response=await fetch(`http://127.0.0.1:${identity.port}/json/list`,{signal:targetSignal});
  if(!response.ok)throw new Error('Cannot read managed target list');
  targets=await response.json();
 }catch(error){signal?.throwIfAborted();if(!deadline.aborted)throw error;throw Object.assign(error,{code:'HOST_ENDPOINT_PENDING'})}
 const target=selectTarget(targets,identity),client=await Protocol.connect(target,identity,{signal});
 try{
  signal?.addEventListener('abort',close,{once:true});signal?.throwIfAborted();await client.send('Page.enable');
 }catch(error){client.close();throw error}finally{signal?.removeEventListener('abort',close)}
 return {client,identity};
 function close(){client.close()}
}
async function status(){
 let identity,stored;try{identity=await readJson(identityPath);stored=await readJson(statusPath)}catch(error){if(error.code==='ENOENT')return {state:'stopped',enabled:false,panelReady:false};throw error}
 if(!alive(identity.pid))return {...stored,state:'stopped',enabled:false,panelReady:false,uiTogglePresent:false};
 if(stored.sessionId!==identity.sessionId)return {state:'disconnected',enabled:false,panelReady:false,reason:'Waiting for managed loader'};
 if(!alive(stored.daemonPid))return {...stored,panelReady:false,uiTogglePresent:false,state:stored.state==='disabled'?'disabled':'restore-unconfirmed',reason:'Loader is not running; use Start to reconnect or fully exit the managed desktop app'};return stored;
}
async function configure(patch){
 await saveConfig(configPath,patch);
 const dataRoot=path.join(stateRoot,'wallpaper');try{await fs.access(path.join(dataRoot,'user-settings.json'))}catch(e){if(e.code==='ENOENT')return {saved:true};throw e}
 const store=require('./wallpaper/store.cjs').createStore(dataRoot),settings=await store.load(),next={reading:{}};
 if(patch.overlayOpacity!==undefined)next.reading.scrim=patch.overlayOpacity;if(patch.positionX!==undefined)next.reading.x=patch.positionX;
 if(patch.backgroundPath){const library=require('./wallpaper/library.cjs').createLibrary({roots:settings.library.roots,dataRoot});await library.scan();next.wallpaper={selectedId:(await library.importFile(path.resolve(patch.backgroundPath))).id,enabled:true}}
 await store.save(require('./wallpaper/schema.cjs').mergeSettings(settings,next));return {saved:true};
}
async function main(){
 if(Number(process.versions.node.split('.')[0])<24)throw new Error('Node.js 24 or newer is required');const [command,...args]=process.argv.slice(2);
 if(command==='daemon')return require('./wallpaper/daemon.cjs').runDaemon(args[0]||identityPath,{connectManaged});if(command==='status')return status();
 if(command==='validate'){const dataRoot=path.join(stateRoot,'wallpaper');try{await fs.access(path.join(dataRoot,'user-settings.json'));await require('./wallpaper/store.cjs').createStore(dataRoot).load()}catch(e){if(e.code!=='ENOENT')throw e;const c=await loadConfig(configPath);await require('./config.cjs').loadImage(c.backgroundPath)}return {valid:true}}
 if(command==='configure')return configure(await readJson(args[0]));if(command==='apply'||command==='disable')return sendCommand(stateRoot,command);throw new Error('Usage: Theme.ps1 -Action Start|Apply|Disable|Status|Close');
}
if(require.main===module)main().then(result=>{if(result)console.log(JSON.stringify(result,null,2))}).catch(error=>{console.error(error.message);process.exitCode=1});
module.exports={connectManaged,verifyIdentity,status,configure};
