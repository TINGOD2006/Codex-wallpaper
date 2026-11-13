const path=require('node:path');
const {connectManaged}=require('../cli.cjs'),{WindowMonitor}=require('../window-monitor.cjs'),{createWallpaperRuntime}=require('../wallpaper/runtime.cjs');
const {structureExpression}=require('../adapters.cjs'),{probeAdapter}=require('../host-adapters/registry.cjs');
const {abortableDelay}=require('../renderer/recovery.cjs');
const {WallpaperHost,canShowFallback}=require('../wallpaper/host.cjs');
const {preloadSceneStill,validFrame}=require('../wallpaper/scene-still.cjs');
async function waitForReadyAdapter({inspect,appVersion,signal,onSample,sleep=abortableDelay}){
 let previous=null,last;
 for(const [index,wait] of [0,150,300,600,1000,1500,1500,...Array(25).fill(1000)].entries()){
  if(index>=7&&last&&!last.ok&&last.requiredChecks.some(c=>!c.passed&&c.id!=='mode'))break;
  if(wait)await sleep(wait,signal);signal?.throwIfAborted();
  const snapshot=await inspect();last=probeAdapter({host:{kind:'codex-desktop',appVersion},structure:snapshot});
  if(onSample)await onSample(snapshot,last);
  signal?.throwIfAborted();
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
 const failed=()=>runtime.controller.playback.state==='error';
 if(hostResponsive()&&failed()&&!runtime.controller.playback.preview)return {suspended:true,connected:true,playback:runtime.controller.playback};
 if(hidden())return suspended();
 if(!hostResponsive())await transport?.recover();
 if(!client.connected)throw Object.assign(new Error('Host disconnected'),{code:'HOST_IDENTITY_CHANGED'});
 if(!hostResponsive()||hidden())return suspended();
 if(failed()&&!runtime.controller.playback.preview)return {suspended:true,connected:true,playback:runtime.controller.playback};
 let proof;
 try{proof=await runtime.refresh()}catch(error){if(client.connected&&(!hostResponsive()||hidden()))return suspended();throw error}
 if(!hostResponsive()||hidden())return suspended();
 const settings=runtime.controller.settings,requestedImage=!!(settings.wallpaper.enabled&&settings.wallpaper.selectedId),lease=runtime.controller.active,rendererHealthy=rendererIsHealthy(settings,runtime.controller.playback,lease,monitor.stableVisible),controllerFailure=runtime.controller.snapshot().failure||{},serviceFailure=rendererService?.failureInfo()||{};
 return {...proof,suspended:failed(),connected:client.connected,layoutPassed:true,rendererHealthy,requestedImage,playback:runtime.controller.playback,failure:{retryManaged:!!rendererService||controllerFailure.retryManaged===true,retryBlocked:serviceFailure.retryBlocked===true||controllerFailure.retryBlocked===true}};
}
function createRuntimeRunner({paths,store,library,presets,rendererService,connect=connectManaged,watchWindow=file=>new WindowMonitor(file),createRuntime=createWallpaperRuntime}){
 let startupImage=null,fallback=null;
 const wantsFallback=settings=>settings?.enabled&&settings.wallpaper?.enabled&&settings.wallpaper.selectedId;
 const sameHost=(a,b)=>a&&b&&a.pid===b.pid&&a.startTime===b.startTime&&a.appVersion===b.appVersion;
 const preload=settings=>{
  if(!wantsFallback(settings))return;
  const selectedId=settings.wallpaper.selectedId,entry=library?.get(selectedId)||{id:selectedId};
  if(startupImage?.selectedId!==selectedId){
   startupImage={selectedId,job:preloadSceneStill({entry,dataRoot:paths.data}).then(candidates=>({selectedId,candidates}),()=>({selectedId,candidates:[]}))};
  }
  return startupImage.job;
 };
 async function clearFallback({client,signal,isCurrent=()=>true}={}){
  const current=fallback;
  if(!current||!isCurrent(current.session))return true;
  let ownedClient;
  try{
   const timeout=AbortSignal.timeout(8000);
   if(!client){({client:ownedClient}=await connect(path.join(current.session.runDirectory,'session.json'),{signal:signal?AbortSignal.any([signal,timeout]):timeout}));client=ownedClient}
   await new WallpaperHost(client,current.session.appVersion).restoreAll({fallbackToken:current.documentToken});
   if(fallback===current)fallback=null;
   return true;
  }catch{return false}finally{ownedClient?.close()}
 }
 return {resetFailures(){rendererService?.resetFailures()},prewarm(settings){
   const entry=library?.get(settings.wallpaper?.selectedId);
   if(paths?.data)void preload(settings);
   if(settings.enabled&&settings.wallpaper?.enabled&&!settings.performance?.powerSaving&&settings.playback?.sceneLive!==false&&!settings.playback?.paused&&entry?.kind==='scene'&&entry.capability==='supported'&&settings.performance?.rendererMode!=='isolated')return rendererService?.warm?.();
  },async probe(session){
   let client;try{({client}=await connect(path.join(session.runDirectory,'session.json')));let token;
    for(let n=0;n<2;n++){if(n)await require('../control.cjs').delay(150);const snapshot=await client.evaluate(`(()=>({...${structureExpression},documentToken:String(performance.timeOrigin)}))()`),adapter=probeAdapter({host:{kind:'codex-desktop',appVersion:session.appVersion},structure:snapshot});if(!adapter.ok||!snapshot.documentToken)return false;const key=JSON.stringify([snapshot.documentToken,adapter.kind]);if(n&&key!==token)return false;token=key}return true;
   }catch{return false}finally{client?.close()}
  },fallbackFor(session){return sameHost(fallback?.session,session)?fallback.source:null},
  clearFallback,
  async attach(session,appearance,{signal,sessionCurrent=()=>true,onFallback=()=>{}}={}){
  signal?.throwIfAborted();const file=path.join(session.runDirectory,'session.json');let client,runtime,monitor,transport;
  try{
   ({client}=await connect(file,{signal}));monitor=watchWindow(file);transport=monitorTransport(client,monitor);
   if(fallback&&!sameHost(fallback.session,session))fallback=null;
   const host=new WallpaperHost(client,session.appVersion);
   const saved=appearance?.controller?.snapshot?null:await store.load();
   const settings=()=>appearance?.controller?.snapshot?.().settings??saved;
   let placeholder,lastSample,attempted;
   const closeRetired=()=>{if(!sessionCurrent())client.close()};
   signal?.addEventListener('abort',closeRetired,{once:true});
   try{
    const adapter=await waitForReadyAdapter({inspect:async()=>{
     if(!transport.responsive())throw Object.assign(new Error('Host is not responding'),{code:'HOST_ENDPOINT_PENDING'});
     lastSample=await host.inspect();
     if(fallback&&lastSample?.documentToken&&fallback.documentToken!==lastSample.documentToken){fallback=null;onFallback(null)}
     return lastSample;
    },appVersion:session.appVersion,signal,onSample:async(snapshot,layout)=>{
     const latest=settings(),selectedId=wantsFallback(latest);
     if(!selectedId){
      placeholder=null;
      attempted=null;
      if(fallback&&await clearFallback({client,signal}))onFallback(null);
      return;
     }
     if(!canShowFallback(snapshot))return;
     if(attempted?.documentToken===snapshot.documentToken&&attempted.selectedId===selectedId)return;
     attempted={documentToken:snapshot.documentToken,selectedId};
     placeholder=null;
     const {candidates}=await preload(latest);
     signal?.throwIfAborted();
     if(!transport.responsive()||wantsFallback(settings())!==selectedId)return;
     const existing=fallback?.selectedId===selectedId&&fallback.documentToken===snapshot.documentToken?fallback:null;
     for(const candidate of existing?[existing,...candidates.filter(image=>image.uri!==existing.uri)]:candidates){
      signal?.throwIfAborted();
      if(!transport.responsive()||wantsFallback(settings())!==selectedId)break;
      if(await host.showFallback(settings(),candidate.uri,snapshot.documentToken,{clearMaterials:!layout.ok})){
       placeholder={uri:candidate.uri,source:candidate.source,selectedId,documentToken:snapshot.documentToken};
       fallback={...placeholder,session};
       if(wantsFallback(settings()))onFallback(candidate.source);
       else if(await clearFallback({client,signal})){placeholder=null;onFallback(null)}
       break;
      }
     }
    }});
    signal?.throwIfAborted();
    const preloaded=preload(settings());
    startupImage=null;
    if(placeholder?.documentToken!==lastSample?.documentToken)placeholder=null;
    runtime=await createRuntime({client,identity:session,projectRoot:path.resolve(__dirname,'../..'),dataRoot:paths.data,runtimeRoot:paths.runtime,mountPanel:false,windowVisible:()=>monitor.stableVisible,hostResponsive:transport.responsive,services:{store,library,presets,appearance,rendererService,startupImage:preloaded,startupPlaceholder:placeholder}});
    signal?.throwIfAborted();
    return {adapter,hostResponsive:transport.responsive,
     subscribeHealth(listener){return rendererService?.onHealth(event=>{const controller=runtime.controller,lease=controller.active,wants=controller.settings.enabled&&controller.settings.wallpaper.enabled&&controller.settings.wallpaper.selectedId;if(!wants||!lease||event.expected)return;const affected=event.scope==='lease'&&event.leaseId===lease.leaseId||event.scope==='pool'&&lease.status.backend==='pool'&&lease.rendererGeneration===event.affectedGeneration;if(affected)listener(event)})},
     async observe(){
      const observed=await observeRuntime({client,runtime,monitor,rendererService,transport});
      if(observed.imageConfirmed&&!observed.playback?.preview||!wantsFallback(runtime.controller.settings))fallback=null;
      return observed;
     },
     async close({preserveFrame=false}={}){
      try{
       const {controller}=runtime;
       const selectedId=wantsFallback(controller.settings);
       const keep=!!(preserveFrame&&selectedId&&(validFrame(controller.paintedFrame)||sameHost(fallback?.session,session)));
       const result=await runtime.close({preserveFrame:keep,retainFrame:keep?async uri=>{
        const source=controller.playback.staticSource||'captured';
        if(validFrame(uri)&&transport.responsive())try{
         const snapshot=await host.inspect();
         const safe=canShowFallback(snapshot);
         const compatible=safe&&probeAdapter({host:{kind:'codex-desktop',appVersion:session.appVersion},structure:snapshot}).ok;
         if(safe&&await host.showFallback(controller.settings,uri,snapshot.documentToken,{clearMaterials:!compatible,existingOnly:true})){
          fallback={uri,source,selectedId,documentToken:snapshot.documentToken,session};return true;
         }else if(snapshot.rootViewportCount>0){
          await host.restoreAll();
          fallback=null;
         }
        }catch{/* Leave the last displayed frame in place if the connection failed. */}
       }:undefined});
       if(!keep&&result?.restored!==false&&sameHost(fallback?.session,session))fallback=null;
       return result;
      }finally{transport.close();monitor.close();client.close()}
     }
    };
   }finally{signal?.removeEventListener('abort',closeRetired)}
  }catch(e){
   await runtime?.close({preserveFrame:sameHost(fallback?.session,session)}).catch(()=>{});transport?.close();monitor?.close();client?.close();signal?.throwIfAborted();
   if(e.code==='UNSUPPORTED_LAYOUT')e.code='ADAPTER_LAYOUT_MISMATCH';
   if(['PROTOCOL_TIMEOUT','HOST_UNRESPONSIVE','LAYOUT_CHANGED'].includes(e.code))e.code='HOST_ENDPOINT_PENDING';
   throw e;
  }
 }};
}
module.exports={createRuntimeRunner,rendererIsHealthy,waitForReadyAdapter,observeRuntime,monitorTransport};
