const {randomUUID}=require('node:crypto'),{createWorkScheduler}=require('./work-scheduler.cjs'),{createPooledRenderer}=require('./pooled-renderer.cjs'),{fingerprintEntry}=require('./source-fingerprint.cjs'),{checkAbort,renderError}=require('./errors.cjs');
function createRendererPool({browser,origin,makeRenderer=createPooledRenderer,cache,scheduler:providedScheduler,idleMs=60000,onLeasesChanged=()=>{}}){
 const scheduler=providedScheduler||createWorkScheduler(),leases=new Set();let active=null,preparing=null,epoch=0,closed=false,idleTimer,commitTail=Promise.resolve();
 const commit=work=>{const next=commitTail.then(work);commitTail=next.catch(()=>{});return next};
 function notify(){onLeasesChanged([...leases].filter(l=>!l.closed).map(l=>({leaseId:l.leaseId,entryFingerprint:l.entryFingerprint,role:l===active?'active':'preparing'})))}
 function clearIdle(){clearTimeout(idleTimer);idleTimer=null}
 function idle(){clearIdle();if(closed||leases.size||preparing)return;idleTimer=setTimeout(()=>{if(!closed&&!leases.size&&!preparing)browser.stop().catch(()=>{})},idleMs);idleTimer.unref?.()}
 async function closeLease(lease){if(lease.closed)return;lease.closed=true;leases.delete(lease);if(active===lease)active=null;notify();try{await lease.renderer.close()}finally{idle()}}
 function wrap(renderer,requestEpoch,purpose){
  const lease={renderer,closed:false,retired:false,...Object.fromEntries(['leaseId','managerInstance','hostGeneration','rendererGeneration','entryFingerprint'].map(k=>[k,renderer[k]]))};
  const valid=()=>{if(lease.invalid)throw renderError(lease.invalid);if(closed||lease.closed||lease.retired)throw renderError('POOL_CLOSED')};
  for(const name of ['frame','nextFrame','pause','resume','setPlayback'])lease[name]=async(...args)=>{valid();return renderer[name](...args)};
  Object.defineProperties(lease,{status:{get:()=>renderer.status},eventDriven:{get:()=>renderer.eventDriven}});
  lease.close=()=>commit(()=>closeLease(lease));
  lease.rollback=()=>lease.close();
  lease.promote=()=>commit(()=>{valid();if(requestEpoch!==epoch||purpose!=='playback')throw renderError('POOL_CLOSED');if(active&&active!==lease)active.retired=true;active=lease;notify();return lease});
  lease.invalidate=code=>{lease.invalid=code;renderer.invalidate?.(code)};
  lease.onInvalidated=listener=>renderer.onInvalidated?.(listener);
  leases.add(lease);notify();return lease;
 }
 function prepare(entry,playback,options={}){
  if(closed)return Promise.reject(renderError('POOL_CLOSED'));const purpose=options.purpose||'playback';if(purpose==='poster'&&preparing)return Promise.reject(renderError('POOL_UNAVAILABLE'));clearIdle();const requestEpoch=++epoch,previous=preparing,controller=new AbortController(),signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal;
  previous?.controller.abort(new DOMException('Superseded wallpaper preparation','AbortError'));
  const pending={controller,promise:null};preparing=pending;
  pending.promise=(async()=>{
   await previous?.promise.catch(()=>{});checkAbort(signal);if(closed)throw renderError('POOL_CLOSED');
   // A completed but uncommitted candidate is no longer allowed to occupy a page.
   for(const lease of [...leases])if(lease!==active)await lease.close();
   return scheduler.run(async({signal:workSignal})=>{
    let target,registration,renderer;
    try{
     const entryFingerprint=options.entryFingerprint||await fingerprintEntry(entry,{signal:workSignal}),started=await browser.start();checkAbort(workSignal);
     const identity={leaseId:randomUUID(),managerInstance:options.managerInstance,hostGeneration:options.hostGeneration,rendererGeneration:options.rendererGeneration??started.browserGeneration,entryFingerprint};
     const cachePolicy=cache&&entry.kind==='scene'?await cache.leasePolicy(identity):{enabled:false};registration=await origin.register(entry,{signal:workSignal,entryFingerprint,identity,playback,cachePolicy});checkAbort(workSignal);
     target=await browser.openTarget({url:registration.rendererUrl,width:playback.width,height:playback.height,signal:workSignal});
     renderer=await makeRenderer({target,registration,playback,identity,cachePolicy,kind:entry.kind,signal:workSignal});checkAbort(workSignal);
     if(requestEpoch!==epoch||closed)throw renderError('POOL_CLOSED');
     // Renderers created by injected factories obey the same identity contract.
     Object.assign(renderer,identity);return wrap(renderer,requestEpoch,purpose);
    }catch(error){if(renderer)await renderer.close();else{try{await target?.close()}finally{await registration?.revoke()}}throw error}
   },{purpose,signal});
  })().finally(()=>{if(preparing===pending)preparing=null;idle()});return pending.promise;
 }
 return {prepare,armIdle:idle,snapshot(){return {active:active?.leaseId||null,preparing:!!preparing,contentLeases:leases.size,scheduler:scheduler.snapshot()}},invalidateAll(code='POOL_LOST'){epoch++;preparing?.controller.abort(renderError(code));for(const lease of leases)lease.invalidate(code);return Promise.allSettled([...leases].map(l=>l.close()))},async close(){if(closed)return;closed=true;clearIdle();epoch++;const pending=preparing;pending?.controller.abort(renderError('POOL_CLOSED'));await pending?.promise.catch(()=>{});for(const lease of [...leases])await lease.close();if(!providedScheduler)await scheduler.close();await commitTail}};
}
module.exports={createRendererPool};
