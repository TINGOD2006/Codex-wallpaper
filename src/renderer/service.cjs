const fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {defaults,mergeSettings}=require('../wallpaper/schema.cjs'),{prepareRenderer}=require('../wallpaper/renderer.cjs');
const {createBrowserOwner}=require('./browser-owner.cjs'),{createAssetOrigin}=require('./asset-origin.cjs'),{createCacheController}=require('./cache-controller.cjs'),{createRendererPool}=require('./pool.cjs'),{probeCapabilities}=require('./pooled-renderer.cjs'),{fingerprintEntry}=require('./source-fingerprint.cjs'),{renderError,canFallback,checkAbort}=require('./errors.cjs');
const {createMetricsTracker}=require('./metrics.cjs');
const {createRecovery,abortableDelay}=require('./recovery.cjs');
function qualifiedHash(){try{const value=JSON.parse(fs.readFileSync(path.join(__dirname,'cache-qualification.json'),'utf8')),guardHash=createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'../scene-renderer/cache-adapter.js'),'utf8').replace(/\r\n/g,'\n')).digest('hex');return value.schemaVersion===1&&value.verified===true&&value.cacheStorageHits===true&&value.fullQuality===true&&value.restartVerified===true&&value.guardHashFormat==='utf8-lf'&&value.guardHash===guardHash?value.engineHash:null}catch{return null}}
function createRendererService(options){
 const {paths,prepareIsolated=prepareRenderer,fingerprint=fingerprintEntry,probe=(owner,source)=>probeCapabilities(owner,source,{durationMs:1000})}=options;
 const browser=options.browser||createBrowserOwner({paths}),origin=options.origin||createAssetOrigin({paths}),cache=options.cache||createCacheController({browser,origin,qualifiedEngineHash:qualifiedHash()}),leases=new Set(),pending=new Set(),listeners=new Set(),closingAbort=new AbortController(),receiverTracker=createMetricsTracker(),managerInstance=options.managerInstance||randomUUID();let receiver={decodedFps:null};
 let performance=defaults().performance,closed=false,closing,active=null,preparing=0,requestEpoch=0,rendererGeneration=1,capabilityGeneration=null,capabilityJob,warmJob,poolFailure=null,pins=[],pinError=null;
 const recovery=createRecovery({now:options.now||Date.now});let needsRecovery=false,recoveryBlocked=false,lastFailureCode=null,invalidatingRoot=false;
 function syncPins(){const next=[...new Set([...pins,...[...leases].filter(l=>l.backend==='pool'&&!l.closed).map(l=>l.entryFingerprint)])];cache.setPins(next).then(()=>{pinError=null},()=>{pinError='CACHE_UNAVAILABLE'})}
 const pool=options.pool||createRendererPool({browser,origin,cache,onLeasesChanged:value=>{pins=value.map(l=>l.entryFingerprint);syncPins()}});
 function notifyHealth(value){for(const listener of listeners)try{listener(value)}catch{}}
 function failureInfo(){return {retryManaged:true,retryBlocked:recoveryBlocked||recovery.snapshot().blocked,reasonCode:lastFailureCode||'RENDERER_FAILED'}}
 function resetFailures(){if(poolFailure)capabilityGeneration=null;poolFailure=null;needsRecovery=false;recoveryBlocked=false;lastFailureCode=null;recovery.resetByUser()}
 function recordFailure(error,lease){if(closed||error?.name==='AbortError')return;lastFailureCode=['OWNER_MISMATCH','LEASE_DOCUMENT_CHANGED','SOURCE_CHANGED','POOL_LOST','POOL_UNAVAILABLE','POOL_PROFILE_BUSY','POOL_TARGET_UNSUPPORTED'].includes(error?.code)?error.code:'RENDERER_FAILED';if(['OWNER_MISMATCH','LEASE_DOCUMENT_CHANGED','SOURCE_CHANGED'].includes(lastFailureCode)||error?.retryBlocked)recoveryBlocked=true;needsRecovery=true;if(lease){lease.invalid=lastFailureCode;notifyHealth({healthy:false,expected:false,scope:'lease',leaseId:lease.leaseId,affectedGeneration:lease.rendererGeneration,rendererGeneration,code:lastFailureCode,...failureInfo()})}}
 const unsubscribe=browser.onLost(event=>{if(closed||event.expected)return;const affectedGeneration=rendererGeneration++;capabilityGeneration=null;capabilityJob=null;if([...leases].some(l=>l.backend==='pool'&&!l.closed)||preparing)needsRecovery=true;lastFailureCode='POOL_LOST';invalidatingRoot=true;pool.invalidateAll('POOL_LOST');invalidatingRoot=false;for(const lease of leases)if(lease.backend==='pool'&&lease.rendererGeneration===affectedGeneration)lease.invalid='POOL_LOST';notifyHealth({healthy:false,expected:false,scope:'pool',affectedGeneration,rendererGeneration,code:'POOL_LOST',...failureInfo()})});
 async function ensurePool(){
  await origin.start();const started=await browser.start();if(capabilityGeneration===started.browserGeneration)return;
  if(!capabilityJob)capabilityJob=(async()=>{
   // Reuse only a successful capture qualification of these exact renderer files
   // and this browser build. Changed code/browser or malformed records re-probe.
   const version=started.browserVersion;let file,key;
   if(!options.probe&&typeof version==='string'){
    const hash=createHash('sha256');for(const name of ['pooled-renderer.cjs','browser-owner.cjs','../frame-stream.cjs','../../assets/webwallgl/webwallgl.global.min.js'])hash.update(fs.readFileSync(path.resolve(__dirname,name)));
    key=version+':'+hash.digest('hex');file=path.join(paths.data,'capture-qualification.json');
    try{const saved=JSON.parse(await fs.promises.readFile(file,'utf8'));if(saved.key===key&&saved.completeFrames===true&&saved.multiWindow===true){capabilityGeneration=started.browserGeneration;return}}catch{}
   }
   const value=await probe(browser,origin);if(value.completeFrames!==true||value.multiWindow!==true)throw renderError('POOL_TARGET_UNSUPPORTED');
   capabilityGeneration=started.browserGeneration;
   if(file)await require('../config.cjs').atomicJson(file,{key,completeFrames:true,multiWindow:true}).catch(()=>{});
  })().finally(()=>{capabilityJob=null});await capabilityJob;
 }

 function warm(){
  if(closed)return Promise.reject(renderError('POOL_CLOSED'));
  if(performance.powerSaving||performance.rendererMode==='isolated'||needsRecovery||recoveryBlocked||recovery.snapshot().blocked)return Promise.resolve(false);
  if(warmJob)return warmJob;
  const job=ensurePool().then(()=>{checkAbort(closingAbort.signal);return true}).finally(()=>{warmJob=null;pending.delete(job);if(!leases.size&&!preparing)pool.armIdle?.()});
  warmJob=job;pending.add(job);return job;
 }
 function wrap(renderer,{backend,kind,entryFingerprint,epoch,purpose,hostGeneration,managerInstance,fallbackReason}){
  const lease={backend,entryFingerprint,leaseId:renderer.leaseId||randomUUID(),managerInstance,hostGeneration,rendererGeneration:renderer.rendererGeneration??rendererGeneration,closed:false,invalid:null};let closeJob;
  const valid=()=>{if(lease.invalid)throw Object.assign(renderError(lease.invalid),failureInfo());if(lease.closed||closed)throw renderError('POOL_CLOSED')};
  for(const method of ['frame','nextFrame','pause','resume','setPlayback'])lease[method]=async(...args)=>{valid();try{return await (renderer[method]||renderer.frame).apply(renderer,args)}catch(error){recordFailure(error,lease);Object.assign(error,failureInfo());throw error}};
  const unsubscribeLease=renderer.onInvalidated?.(code=>{if(lease.closed||closed)return;lease.invalid=code;if(!invalidatingRoot)recordFailure(renderError(code),lease)});
  Object.defineProperties(lease,{status:{get:()=>({...renderer.status,kind,backend,fallbackReason:fallbackReason||null})},eventDriven:{get:()=>renderer.eventDriven===true}});
  lease.promote=async()=>{valid();if(purpose!=='playback'||epoch!==requestEpoch)throw renderError('POOL_CLOSED');await renderer.promote?.();active=lease;receiverTracker.reset();receiver={decodedFps:null};syncPins();return lease};
  lease.close=()=>{if(closeJob)return closeJob;lease.closed=true;unsubscribeLease?.();leases.delete(lease);if(active===lease){active=null;receiverTracker.reset();receiver={decodedFps:null}}syncPins();closeJob=Promise.resolve().then(()=>renderer.close());return closeJob};
  lease.rollback=()=>lease.close();leases.add(lease);syncPins();return lease;
 }
 async function prepareWork(entry,playback,settings){
  const {signal,purpose='playback'}=settings;checkAbort(signal);if(closed)throw renderError('POOL_CLOSED');const still=require('../wallpaper/scene-still.cjs').usesStill(entry,playback);if(entry?.capability!=='supported'&&!still)throw new Error('Wallpaper source unavailable');
  if(settings.explicitRetry&&purpose==='playback')resetFailures();
  if(!still&&entry.kind!=='image'&&(recoveryBlocked||recovery.snapshot().blocked))throw Object.assign(new Error('RENDERER_FAILED'),{code:'RENDERER_FAILED',...failureInfo(),retryBlocked:true});
  const policy=mergeSettings(defaults(),{performance:settings.performance||performance}).performance,epoch=purpose==='playback'?++requestEpoch:requestEpoch;let entryFingerprint,renderer,backend,fallbackReason=null;preparing++;
  try{
   try{entryFingerprint=still?createHash('sha256').update('still:'+entry.id).digest('hex'):await fingerprint(entry,{signal})}catch(error){if(error.name!=='AbortError')error.retryBlocked=true;throw error}checkAbort(signal);
   if(!still&&entry.kind!=='image'&&(recoveryBlocked||recovery.snapshot().blocked))throw Object.assign(new Error('RENDERER_FAILED'),{code:'RENDERER_FAILED',...failureInfo(),retryBlocked:true});
   if(!still&&needsRecovery&&purpose==='playback'&&entry.kind!=='image'){if(!recovery.allowRestart())throw Object.assign(new Error('RENDERER_FAILED'),{code:'RENDERER_FAILED',...failureInfo(),retryBlocked:true});await (options.sleep||abortableDelay)(recovery.delayMs(),signal);checkAbort(signal);needsRecovery=false}
   if(still){backend='image';renderer=require('../wallpaper/scene-still.cjs').createStillRenderer(settings.still)}
   else if(entry.kind==='image'&&purpose!=='poster'){backend='image';renderer=await prepareIsolated(entry,playback,{signal,runtimeRoot:paths.runtime})}
   else if(policy.rendererMode==='isolated'){backend='isolated';renderer=await prepareIsolated(entry,playback,{signal,runtimeRoot:paths.runtime})}
   else{
    try{if(policy.rendererMode==='auto'&&poolFailure)throw renderError(poolFailure);await ensurePool();checkAbort(signal);renderer=await pool.prepare(entry,playback,{...settings,managerInstance,entryFingerprint,signal,purpose,rendererGeneration});backend='pool'}
    catch(error){checkAbort(signal);if(policy.rendererMode!=='auto'||!canFallback(error))throw error;poolFailure=error.code;fallbackReason=error.code;backend='isolated';renderer=await prepareIsolated(entry,playback,{signal,runtimeRoot:paths.runtime})}
   }
   checkAbort(signal);if(closed)throw renderError('POOL_CLOSED');return wrap(renderer,{backend,kind:entry.kind,entryFingerprint,epoch,purpose,hostGeneration:settings.hostGeneration,managerInstance,fallbackReason});
  }catch(error){await renderer?.close();recordFailure(error);if(error.name!=='AbortError')Object.assign(error,failureInfo());throw error}finally{preparing--;if(!leases.size&&!preparing)pool.armIdle?.()}
 }
 function prepare(entry,playback,settings={}){const signal=settings.signal?AbortSignal.any([settings.signal,closingAbort.signal]):closingAbort.signal,job=prepareWork(entry,playback,{...settings,signal});pending.add(job);job.then(()=>pending.delete(job),()=>pending.delete(job));return job}
 async function configure(value){const next=mergeSettings(defaults(),{performance:value}).performance;await cache.configure(next);if(JSON.stringify(next)!==JSON.stringify(performance))resetFailures();performance=next}
 async function poster(entry,{signal,performance:policy=performance}={}){
  if(performance.powerSaving||closed||preparing||pool.snapshot().preparing||pool.snapshot().contentLeases>0||[...leases].some(l=>!l.closed&&l.backend!=='image')||!['image','video'].includes(entry?.kind))return null;
  const timeout=new AbortController(),combined=signal?AbortSignal.any([signal,timeout.signal]):timeout.signal;let lease,timer;
  const work=prepare(entry,{...defaults().playback,renderFps:20,displayFps:1,width:320,height:240},{signal:combined,purpose:'poster',performance:{...policy,rendererMode:'pool',cacheEnabled:false}}).then(async value=>{lease=value;return await lease.frame()}).finally(()=>lease?.close());work.catch(()=>{});
  const deadline=new Promise(resolve=>{timer=setTimeout(()=>{timeout.abort(new DOMException('Poster deadline','AbortError'));resolve(null)},5000)});
  try{return await Promise.race([work.catch(()=>null),deadline])}finally{clearTimeout(timer)}
 }
 function snapshot(){
  const state=active?.status||{},cached={...cache.snapshot()};
  if(active&&(state.kind!=='scene'||state.backend!=='pool')){cached.effectiveCacheEnabled=false;cached.reason='CACHE_NOT_APPLICABLE'}
  else if(active&&state.cacheReason){cached.effectiveCacheEnabled=false;cached.reason='CACHE_UNAVAILABLE'}
  else if(active&&state.cacheAllowed&&state.cacheEpoch!==cached.epoch){cached.effectiveCacheEnabled=false;cached.reason='CACHE_RELOAD_REQUIRED'}
  else if(active&&cached.effectiveCacheEnabled&&state.cacheAllowed!==true){cached.effectiveCacheEnabled=false;cached.reason='CACHE_RELOAD_REQUIRED'}
  if(pinError){cached.effectiveCacheEnabled=false;cached.reason=pinError}
  return {controlsAvailable:true,healthy:active?!active.invalid&&['ready','paused'].includes(state.state):!needsRecovery&&!recoveryBlocked,rendererGeneration:active?.rendererGeneration??rendererGeneration,recovery:{...recovery.snapshot(),blocked:failureInfo().retryBlocked,lastFailureCode},rendererVersion:cache.engineHash==='2f86ab955f3377e2fa2cfd5ffa72f5813fe8f6e4a272295fed36f4c1e626b1e5'?'3.0.0':null,browserVersion:browser.snapshot().browserVersion||null,backend:state.backend||null,fallbackReason:state.fallbackReason||null,sourceSize:state.sourceSize||receiver.outputSize||null,outputSize:state.outputSize||receiver.outputSize||null,gpu:state.gpu||null,renderFps:state.renderFps??null,captureFps:state.captureFps??null,decodedFps:receiver.decodedFps,quality:state.quality||null,bake:state.bake||null,cache:cached,pool:pool.snapshot()};
 }
 return {configure,prepare,poster,warm,managerInstance,getPerformance:()=>structuredClone(performance),failureInfo,onHealth(listener){listeners.add(listener);return()=>listeners.delete(listener)},observeReceiver(sample){receiver=active&&!active.invalid&&sample&&sample.leaseId===active.leaseId?{...receiverTracker.observe(sample),outputSize:sample.outputSize||null}:receiverTracker.observe(null);return receiver},resetFailures,snapshot,async refresh(){await cache.refresh();return snapshot()},async clearCache(){await origin.start();try{return await cache.clear()}finally{if(!leases.size&&!preparing)pool.armIdle?.()}},close(){if(closing)return closing;closed=true;closingAbort.abort(renderError('POOL_CLOSED'));unsubscribe?.();closing=(async()=>{await Promise.allSettled([...pending]);const errors=[];for(const work of [...[...leases].map(l=>()=>l.close()),()=>pool.close(),()=>cache.close(),()=>browser.close(),()=>origin.close()])try{await work()}catch(error){errors.push(error)}listeners.clear();if(errors.length)throw new AggregateError(errors,'Renderer service cleanup failed')})();return closing}};
}
module.exports={createRendererService};
