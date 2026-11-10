const path=require('node:path');
const {connectManaged}=require('../cli.cjs'),{WindowMonitor}=require('../window-monitor.cjs'),{createWallpaperRuntime}=require('../wallpaper/runtime.cjs');
const {structureExpression}=require('../adapters.cjs'),{probeAdapter}=require('../host-adapters/registry.cjs');
async function waitForReadyAdapter({inspect,appVersion,signal,sleep=require('../control.cjs').delay}){
 let previous=null,last;
 for(const [index,wait] of [0,150,300,600,1000,1500,1500,...Array(25).fill(1000)].entries()){
  if(index>=7&&last&&!last.ok&&last.requiredChecks.some(c=>!c.passed&&c.id!=='mode'))break;
  if(wait)await sleep(wait);signal?.throwIfAborted();
  const snapshot=await inspect();last=probeAdapter({host:{kind:'codex-desktop',appVersion},structure:snapshot});
  const key=last.ok&&snapshot.documentToken?JSON.stringify([snapshot.documentToken,last.kind]):null;
  if(key&&key===previous)return last;
  previous=key;
 }
 throw Object.assign(new Error(last?.reason||'Desktop is not ready'),{code:last?.requiredChecks.filter(c=>!c.passed).length===1&&last.requiredChecks.some(c=>!c.passed&&c.id==='mode')?'HOST_SHELL_PENDING':'ADAPTER_LAYOUT_MISMATCH',stage:'probe',checks:last?.requiredChecks});
}
function rendererIsHealthy(settings,playback,lease,visible){
 if(!settings.enabled||!settings.wallpaper.enabled||!settings.wallpaper.selectedId)return true;
 if(lease)return !lease.invalid&&['ready','paused'].includes(lease.status.state);
 // The controller intentionally releases a renderer after 60 seconds suspended.
 if(settings.playback.pauseWhenHidden&&playback.suspended===true&&(playback.state==='paused'||playback.state==='loading'&&playback.pendingId))return true;
 return playback.state==='paused'&&(settings.playback.paused||settings.playback.pauseWhenHidden&&!visible);
}
async function observeRuntime({client,runtime,monitor,rendererService}){
 if(!client.connected)throw Object.assign(new Error('Host disconnected'),{code:'HOST_IDENTITY_CHANGED'});
 if(runtime.controller.playback.state==='error')return {suspended:true,connected:true,playback:runtime.controller.playback};
 const suspended=()=>({suspended:true,connected:client.connected,playback:{...runtime.controller.playback,state:'paused',suspended:true}}),shouldSuspend=()=>runtime.controller.settings.playback.pauseWhenHidden&&!monitor.stableVisible;
 // Chromium throttles hidden pages. Do not inspect/repair the host while it is
 // minimized, or convert normal suspension into a disconnect/reapply cycle.
 if(shouldSuspend())return suspended();
 let proof;try{proof=await runtime.refresh()}catch(error){if(client.connected&&shouldSuspend())return suspended();throw error}
 if(shouldSuspend())return suspended();
 const settings=runtime.controller.settings,requestedImage=!!(settings.wallpaper.enabled&&settings.wallpaper.selectedId),lease=runtime.controller.active,rendererHealthy=rendererIsHealthy(settings,runtime.controller.playback,lease,monitor.stableVisible),controllerFailure=runtime.controller.snapshot().failure||{},serviceFailure=rendererService?.failureInfo()||{};
 return {...proof,suspended:false,connected:client.connected,layoutPassed:true,rendererHealthy,requestedImage,playback:runtime.controller.playback,failure:{retryManaged:!!rendererService||controllerFailure.retryManaged===true,retryBlocked:serviceFailure.retryBlocked===true||controllerFailure.retryBlocked===true}};
}
function createRuntimeRunner({paths,store,library,presets,rendererService,connect=connectManaged}){
 let startupImage=null;
 return {resetFailures(){rendererService?.resetFailures()},prewarm(settings){
   const entry=library?.get(settings.wallpaper?.selectedId);
   if(settings.enabled&&settings.wallpaper?.enabled&&['scene','video'].includes(entry?.kind)&&paths?.data){const selectedId=entry.id;startupImage={selectedId,job:require('../wallpaper/scene-still.cjs').preloadSceneStill({entry,dataRoot:paths.data}).then(candidates=>({selectedId,candidates}),()=>({selectedId,candidates:[]}))}}
   if(settings.enabled&&settings.wallpaper?.enabled&&!settings.performance?.powerSaving&&settings.playback?.sceneLive!==false&&!settings.playback?.paused&&entry?.kind==='scene'&&entry.capability==='supported'&&settings.performance?.rendererMode!=='isolated')return rendererService?.warm?.();
  },async probe(session){
   let client;try{({client}=await connect(path.join(session.runDirectory,'session.json')));let token;
    for(let n=0;n<2;n++){if(n)await require('../control.cjs').delay(150);const snapshot=await client.evaluate(`(()=>({...${structureExpression},documentToken:String(performance.timeOrigin)}))()`),adapter=probeAdapter({host:{kind:'codex-desktop',appVersion:session.appVersion},structure:snapshot});if(!adapter.ok||!snapshot.documentToken)return false;const key=JSON.stringify([snapshot.documentToken,adapter.kind]);if(n&&key!==token)return false;token=key}return true;
   }catch{return false}finally{client?.close()}
  },async attach(session,appearance,{signal}={}){
  signal?.throwIfAborted();const file=path.join(session.runDirectory,'session.json'),{client}=await connect(file);let runtime,monitor;
  try{
   const adapter=await waitForReadyAdapter({inspect:()=>client.evaluate(`(()=>({...${structureExpression},documentToken:String(performance.timeOrigin)}))()`),appVersion:session.appVersion,signal});
   signal?.throwIfAborted();monitor=new WindowMonitor(file);
   const preloaded=startupImage?.job;startupImage=null;
   runtime=await createWallpaperRuntime({client,identity:session,projectRoot:path.resolve(__dirname,'../..'),dataRoot:paths.data,runtimeRoot:paths.runtime,mountPanel:false,windowVisible:()=>monitor.stableVisible,services:{store,library,presets,appearance,rendererService,startupImage:preloaded}});signal?.throwIfAborted();
   return {adapter,
    subscribeHealth(listener){return rendererService?.onHealth(event=>{const controller=runtime.controller,lease=controller.active,wants=controller.settings.enabled&&controller.settings.wallpaper.enabled&&controller.settings.wallpaper.selectedId;if(!wants||!lease||event.expected)return;const affected=event.scope==='lease'&&event.leaseId===lease.leaseId||event.scope==='pool'&&lease.status.backend==='pool'&&lease.rendererGeneration===event.affectedGeneration;if(affected)listener(event)})},
    observe(){return observeRuntime({client,runtime,monitor,rendererService})},
    async close(){try{return await runtime.close()}finally{monitor.close();client.close()}}
   };
  }catch(e){await runtime?.close().catch(()=>{});monitor?.close();client.close();if(e.code==='UNSUPPORTED_LAYOUT')e.code='ADAPTER_LAYOUT_MISMATCH';throw e}
 }};
}
module.exports={createRuntimeRunner,rendererIsHealthy,waitForReadyAdapter,observeRuntime};
