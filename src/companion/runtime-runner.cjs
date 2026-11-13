const path=require('node:path');
const {connectManaged}=require('../cli.cjs'),{WindowMonitor}=require('../window-monitor.cjs'),{createWallpaperRuntime}=require('../wallpaper/runtime.cjs');
const {structureExpression}=require('../adapters.cjs'),{probeAdapter}=require('../host-adapters/registry.cjs');
const {abortableDelay}=require('../renderer/recovery.cjs');
async function waitForReadyAdapter({inspect,appVersion,signal,sleep=abortableDelay}){
 let previous=null,last;
 for(const [index,wait] of [0,150,300,600,1000,1500,1500,...Array(25).fill(1000)].entries()){
  if(index>=7&&last&&!last.ok&&last.requiredChecks.some(c=>!c.passed&&c.id!=='mode'))break;
  if(wait)await sleep(wait,signal);signal?.throwIfAborted();
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
 if(playback.suspended===true&&(playback.state==='paused'||playback.state==='loading'&&playback.pendingId))return true;
 return playback.state==='paused'&&(settings.playback.paused||settings.playback.pauseWhenHidden&&!visible);
}
function monitorTransport(client,monitor,now=Date.now){
 let retryAt=0,delay=2000,failures=0;
 const timedOut=()=>{
  failures++;
  retryAt=now()+delay;delay=Math.min(8000,delay*2);
 };
 client.on?.('requestTimeout',timedOut);
 return {
  responsive:()=>client.connected!==false&&monitor.stableResponsive!==false&&retryAt===0,
  async recover(){
   if(!retryAt||now()<retryAt||monitor.stableResponsive===false)return;
   if(failures>=4)throw Object.assign(new Error('Host transport stopped responding'),{code:'HOST_IDENTITY_CHANGED'});
   const attempted=failures;
   try{await client.evaluate('true')}catch(error){if(!client.connected||error.code!=='PROTOCOL_TIMEOUT')throw error;return}
   if(failures===attempted){retryAt=0;delay=2000;failures=0}
  },
  close(){client.off?.('requestTimeout',timedOut)}
 };
}
async function observeRuntime({client,runtime,monitor,rendererService,transport}){
 if(!client.connected)throw Object.assign(new Error('Host disconnected'),{code:'HOST_IDENTITY_CHANGED'});
 const hostResponsive=()=>monitor.stableResponsive!==false&&transport?.responsive()!==false;
 const suspended=()=>({suspended:true,connected:client.connected,hostUnresponsive:!hostResponsive(),playback:{...runtime.controller.playback,state:'paused',suspended:true}});
 const hidden=()=>runtime.controller.settings?.playback.pauseWhenHidden&&!monitor.stableVisible;
 // Avoid both DOM repairs and protocol pings while the native window is hung.
 if(monitor.stableResponsive===false)return suspended();
 if(hostResponsive()&&runtime.controller.playback.state==='error')return {suspended:true,connected:true,playback:runtime.controller.playback};
 if(hidden())return suspended();
 if(!hostResponsive())await transport?.recover();
 if(!client.connected)throw Object.assign(new Error('Host disconnected'),{code:'HOST_IDENTITY_CHANGED'});
 if(!hostResponsive()||hidden())return suspended();
 if(runtime.controller.playback.state==='error')return {suspended:true,connected:true,playback:runtime.controller.playback};
 let proof;
 try{proof=await runtime.refresh()}catch(error){if(client.connected&&(!hostResponsive()||hidden()))return suspended();throw error}
 if(!hostResponsive()||hidden())return suspended();
 const settings=runtime.controller.settings,requestedImage=!!(settings.wallpaper.enabled&&settings.wallpaper.selectedId),lease=runtime.controller.active,rendererHealthy=rendererIsHealthy(settings,runtime.controller.playback,lease,monitor.stableVisible),controllerFailure=runtime.controller.snapshot().failure||{},serviceFailure=rendererService?.failureInfo()||{};
 return {...proof,suspended:false,connected:client.connected,layoutPassed:true,rendererHealthy,requestedImage,playback:runtime.controller.playback,failure:{retryManaged:!!rendererService||controllerFailure.retryManaged===true,retryBlocked:serviceFailure.retryBlocked===true||controllerFailure.retryBlocked===true}};
}
function createRuntimeRunner({paths,store,library,presets,rendererService,connect=connectManaged}){
 let startupImage=null;
 return {resetFailures(){rendererService?.resetFailures()},prewarm(settings){
   const entry=library?.get(settings.wallpaper?.selectedId);
   if(settings.enabled&&settings.wallpaper?.enabled&&['scene','video'].includes(entry?.kind)&&paths?.data&&startupImage?.selectedId!==entry.id){const selectedId=entry.id;startupImage={selectedId,job:require('../wallpaper/scene-still.cjs').preloadSceneStill({entry,dataRoot:paths.data}).then(candidates=>({selectedId,candidates}),()=>({selectedId,candidates:[]}))}}
   if(settings.enabled&&settings.wallpaper?.enabled&&!settings.performance?.powerSaving&&settings.playback?.sceneLive!==false&&!settings.playback?.paused&&entry?.kind==='scene'&&entry.capability==='supported'&&settings.performance?.rendererMode!=='isolated')return rendererService?.warm?.();
  },async probe(session){
   let client;try{({client}=await connect(path.join(session.runDirectory,'session.json')));let token;
    for(let n=0;n<2;n++){if(n)await require('../control.cjs').delay(150);const snapshot=await client.evaluate(`(()=>({...${structureExpression},documentToken:String(performance.timeOrigin)}))()`),adapter=probeAdapter({host:{kind:'codex-desktop',appVersion:session.appVersion},structure:snapshot});if(!adapter.ok||!snapshot.documentToken)return false;const key=JSON.stringify([snapshot.documentToken,adapter.kind]);if(n&&key!==token)return false;token=key}return true;
   }catch{return false}finally{client?.close()}
  },async attach(session,appearance,{signal,sessionCurrent=()=>true}={}){
  signal?.throwIfAborted();const file=path.join(session.runDirectory,'session.json');let client,runtime,monitor,transport;
  try{
   ({client}=await connect(file,{signal}));monitor=new WindowMonitor(file);transport=monitorTransport(client,monitor);
   const closeRetired=()=>{if(!sessionCurrent())client.close()};
   signal?.addEventListener('abort',closeRetired,{once:true});
   try{
    const adapter=await waitForReadyAdapter({inspect:()=>{
     if(!transport.responsive())throw Object.assign(new Error('Host is not responding'),{code:'HOST_ENDPOINT_PENDING'});
     return client.evaluate(`(()=>({...${structureExpression},documentToken:String(performance.timeOrigin)}))()`);
    },appVersion:session.appVersion,signal});
    signal?.throwIfAborted();
    const preloaded=startupImage?.job;startupImage=null;
    runtime=await createWallpaperRuntime({client,identity:session,projectRoot:path.resolve(__dirname,'../..'),dataRoot:paths.data,runtimeRoot:paths.runtime,mountPanel:false,windowVisible:()=>monitor.stableVisible,hostResponsive:transport.responsive,services:{store,library,presets,appearance,rendererService,startupImage:preloaded}});
    signal?.throwIfAborted();
    return {adapter,hostResponsive:transport.responsive,
     subscribeHealth(listener){return rendererService?.onHealth(event=>{const controller=runtime.controller,lease=controller.active,wants=controller.settings.enabled&&controller.settings.wallpaper.enabled&&controller.settings.wallpaper.selectedId;if(!wants||!lease||event.expected)return;const affected=event.scope==='lease'&&event.leaseId===lease.leaseId||event.scope==='pool'&&lease.status.backend==='pool'&&lease.rendererGeneration===event.affectedGeneration;if(affected)listener(event)})},
     observe(){return observeRuntime({client,runtime,monitor,rendererService,transport})},
     async close(){try{return await runtime.close()}finally{transport.close();monitor.close();client.close()}}
    };
   }finally{signal?.removeEventListener('abort',closeRetired)}
  }catch(e){
   await runtime?.close().catch(()=>{});transport?.close();monitor?.close();client?.close();signal?.throwIfAborted();
   if(e.code==='UNSUPPORTED_LAYOUT')e.code='ADAPTER_LAYOUT_MISMATCH';
   if(['PROTOCOL_TIMEOUT','HOST_UNRESPONSIVE','LAYOUT_CHANGED'].includes(e.code))e.code='HOST_ENDPOINT_PENDING';
   throw e;
  }
 }};
}
module.exports={createRuntimeRunner,rendererIsHealthy,waitForReadyAdapter,observeRuntime,monitorTransport};
