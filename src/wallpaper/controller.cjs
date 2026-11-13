const {defaults,mergeSettings,validateSettings}=require('./schema.cjs');
const {delay}=require('../control.cjs');
const {validateViewport,resolveRenderSize}=require('../renderer/viewport.cjs');
const {usesStill}=require('./scene-still.cjs');
function hostUnresponsive(){return Object.assign(new Error('Codex 暫時沒有回應，請等視窗恢復後再調整桌布。'),{code:'HOST_UNRESPONSIVE'})}
class WallpaperController {
  constructor({store,library,host,prepareRenderer,windowVisible=()=>true,hostResponsive=()=>true}){
    Object.assign(this,{store,library,host,prepareRenderer,windowVisible,hostResponsive});this.settings=defaults();this.desired=defaults();this.playback={state:'off',selectedId:null,pendingId:null};
    this.revision=0;this.tail=Promise.resolve();this.loading=new Set();this.closed=false;this.active=null;this.activeKey=null;this.activeRequestKey=null;this.dirty=false;this.error=null;this.lastSwitch=Date.now();this.idleSince=0;this.retryInitialRenderer=false;
    this.latestViewport=null;this.renderEpoch=0;this.pendingUserRequests=0;this.userJobs=new Set();this.resizePending=false;
  }
  snapshot(){return structuredClone({settings:this.settings,playback:this.playback,dirty:this.dirty,error:this.error,failure:this.failure||null,revision:this.revision})}
  outputSuspended(settings=this.settings){return !this.hostResponsive()||settings.playback.pauseWhenHidden&&!this.windowVisible()}
  async start({placeholder}={}){
    this.settings=await this.store.load();this.desired=structuredClone(this.settings);
    if(placeholder&&placeholder.selectedId===this.settings.wallpaper.selectedId&&this.settings.enabled&&this.settings.wallpaper.enabled){
      this.active=require('./scene-still.cjs').createStillRenderer({...placeholder,preview:true});this.activeKey=this.activeRequestKey='startup-preview:'+placeholder.selectedId;this.paintedFrame=placeholder.uri;this.paintedRenderer=this.active;
      this.playback={state:'loading',preview:true,staticSource:placeholder.source,selectedId:placeholder.selectedId,pendingId:placeholder.selectedId};
      this.initialRequest=this.request(this.settings).catch(()=>{});
    }else{try{await this.request(this.settings)}catch{}}
    this.loop=this.run();return this.snapshot();
  }
  commit(work){const result=this.tail.then(work);this.tail=result.catch(()=>{});return result}
  paint(frame,renderer,{decoded=false}={}){return this.host.paint(frame,{leaseId:renderer?.leaseId||null,decoded})}
  async paintConfirmed(frame,renderer){
    return await this.paint(frame,renderer,{decoded:true})!==false&&
      (this.host.supportsDecodedPaint||!this.host.confirmImage||await this.host.confirmImage(frame));
  }
  async persist(){try{await this.store.save(this.settings);this.dirty=false;this.error=null}catch(e){this.dirty=true;this.error='未儲存：'+e.message}}
  request(value,options){
    if(this.closed)return Promise.reject(new Error('Wallpaper controller is closed'));
    if(!this.hostResponsive())return Promise.reject(hostUnresponsive());
    this.pendingUserRequests++;this.renderEpoch++;if(this.resizeJob){this.resizeAbort?.abort();this.resizePending=true}
    const job=this.requestSettings(value,options).finally(()=>{this.pendingUserRequests--;if(!this.pendingUserRequests&&this.resizePending)queueMicrotask(()=>this.flushViewport().catch(()=>{}))});this.userJobs.add(job);job.then(()=>this.userJobs.delete(job),()=>this.userJobs.delete(job));return job;
  }
  renderPlayback(settings){const size=resolveRenderSize({playback:settings.playback,performance:{...settings.performance,qualityMode:'fixed'},viewport:this.latestViewport});return {size,playback:{...settings.playback,powerSaving:settings.performance.powerSaving,width:size.width,height:size.height,qualityMode:'fixed',captureQuality:92,renderFps:settings.playback.renderFps,displayFps:settings.playback.displayFps}}}
  rendererKey(entry,settings,playback){return entry?entry.id+':'+playback.width+'x'+playback.height+':'+JSON.stringify(settings.performance)+':'+(entry.kind==='scene'?settings.playback.sceneLive:'media'):null}
  async requestSettings(value,{persist=true,forceReload=false,explicitRetry=false}={}){
    if(this.closed)throw new Error('Wallpaper controller is closed');
    const next=validateSettings(value),revision=++this.revision;this.desired=structuredClone(next);this.pendingAbort?.abort();const abort=new AbortController();this.pendingAbort=abort;
    const wants=next.enabled&&next.wallpaper.enabled&&next.wallpaper.selectedId;
    const entry=wants?this.library.get(next.wallpaper.selectedId):null;
    const output=this.renderPlayback(next),key=this.rendererKey(entry,next,output.playback);
    let candidate=this.active,frame=null,created=false,pausedOld=null;
    try{
      if(wants&&(!entry||entry.capability!=='supported')&&!usesStill(entry,output.playback))throw Object.assign(new Error(entry?.reason||'桌布參照不存在或尚未支援'),{retryBlocked:true});
      if(wants&&(!candidate||candidate.status.state==='error'||this.activeRequestKey!==key||forceReload)){
        this.playback={...this.playback,state:'loading',pendingId:entry.id};
        await this.commit(async()=>{if(revision!==this.revision||this.closed)return;if(this.active){pausedOld=this.active;try{await pausedOld.pause()}catch(error){if(!usesStill(entry,output.playback))throw error}}});
        if(revision!==this.revision||this.closed)return this.snapshot();
        const job=this.prepareRenderer(entry,output.playback,{signal:abort.signal,performance:next.performance,explicitRetry,stillFrame:this.settings.wallpaper.selectedId===entry.id&&!this.active?.status?.still?this.paintedFrame:null});this.loading.add(job);job.then(()=>this.loading.delete(job),()=>this.loading.delete(job));
        candidate=await job;created=true;
      }
      if(revision!==this.revision||this.closed){if(created)await candidate.close();return this.snapshot()}
      if(wants){frame=await candidate.frame();if(!this.hostResponsive())throw hostUnresponsive();if(!this.host.supportsDecodedPaint)await this.host.validateImage(frame)}
      return await this.commit(async()=>{
        if(revision!==this.revision||this.closed){if(created)await candidate.close();return this.snapshot()}
        const old=this.active,oldKey=this.activeKey,oldRequestKey=this.activeRequestKey,oldFrame=this.paintedRenderer===old?this.paintedFrame:null,previous=this.settings;
        const current=()=>{if(revision!==this.revision||this.closed)throw new DOMException('Superseded wallpaper commit','AbortError');if(!this.hostResponsive())throw hostUnresponsive()};
        try{
          current();
          if(!next.enabled)await this.host.restoreAll();else await this.host.apply(next);
          current();
          if(wants){
            await candidate.setPlayback(output.playback);current();
            if(!await this.paintConfirmed(frame,candidate))throw new Error('Wallpaper candidate was not decoded in the host');
            current();
            if(created)await candidate.promote?.();
            this.active=candidate;this.activeRequestKey=key;this.activeKey=key+':'+(candidate.entryFingerprint||'')+':'+(candidate.status.backend||'');this.renderSize=output.size;this.paintedFrame=frame;this.paintedRenderer=candidate;
          }else{await this.host.clearBackground();this.paintedFrame=null;this.paintedRenderer=null;await old?.pause().catch(()=>{})}
        }catch(e){
          this.active=old;this.activeKey=oldKey;this.activeRequestKey=oldRequestKey;
          if(this.hostResponsive())try{if(previous.enabled)await this.host.apply(previous);else await this.host.restoreAll();if(old&&previous.enabled&&previous.wallpaper.enabled){const restored=oldFrame||await old.frame();if(await this.paintConfirmed(restored,old)){this.paintedFrame=restored;this.paintedRenderer=old}}}catch{}
          throw e;
        }
        if(created||previous.playback.renderFps!==next.playback.renderFps||previous.playback.displayFps!==next.playback.displayFps||previous.playback.paused!==next.playback.paused){this.samples=[];this.nextDisplayAt=0}
        this.settings=next;if(this.failure)this.error=null;this.failure=null;if(previous.wallpaper.selectedId!==next.wallpaper.selectedId)this.lastSwitch=Date.now();
        this.playback={state:wants?(candidate.status.still?'static':next.playback.paused?'paused':'playing'):'off',staticSource:candidate?.status.staticSource||null,selectedId:next.wallpaper.selectedId,pendingId:null};
        if(created&&old&&old!==candidate)await old.close();
        if(persist)await this.persist();else this.dirty=true;return this.snapshot();
      });
    }catch(e){
      if(created&&candidate!==this.active)await (candidate.rollback?candidate.rollback():candidate.close()).catch(()=>{});
      if(revision!==this.revision||this.closed)return this.snapshot();
      if(!this.hostResponsive()||e.code==='HOST_UNRESPONSIVE'){
        this.desired=structuredClone(this.settings);this.retryInitialRenderer=this.active?.status.preview===true;
        this.playback={...this.playback,state:'paused',suspended:true,pendingId:null};
        throw e;
      }
      if(pausedOld&&pausedOld===this.active&&this.settings.enabled&&this.settings.wallpaper.enabled&&!this.desired.playback.paused&&!this.outputSuspended())await this.commit(async()=>{if(revision===this.revision&&!this.closed&&pausedOld===this.active&&!this.outputSuspended())await pausedOld.resume()});
      if(revision!==this.revision||this.closed)return this.snapshot();
      if(this.settings.playback.paused!==this.desired.playback.paused){this.settings=mergeSettings(this.settings,{playback:{paused:this.desired.playback.paused}});this.dirty=true}
      this.desired=structuredClone(this.settings);this.error=e.message;this.failure={retryBlocked:e.retryBlocked===true,retryManaged:e.retryManaged===true};this.playback={...this.playback,state:'error',pendingId:null,error:e.message};throw e;
    }
  }
  patch(patch,options={}){const explicitRetry=options.explicitRetry??!!(patch.enabled===true||patch.performance?.powerSaving===false||patch.playback?.sceneLive===true||patch.wallpaper?.enabled===true||patch.wallpaper&&Object.hasOwn(patch.wallpaper,'selectedId'));return this.request(mergeSettings(this.desired,patch),{...options,explicitRetry})}
  select(id,{explicitRetry=true}={}){return this.patch({wallpaper:{selectedId:id,enabled:true}},{forceReload:true,explicitRetry})}
  setPaused(value){return this.patch({playback:{paused:value}})}
  applyPreset(settings){return this.request({...settings,performance:structuredClone(this.desired.performance)})}
  resetSection(name){
    const d=defaults();if(!['reading','materials','colors','playback'].includes(name))return Promise.reject(new Error('Invalid reset section'));
    return this.patch(name==='materials'?{materials:d.materials,colors:d.colors}:{[name]:d[name]});
  }
  resetAll(){const d=defaults();d.enabled=false;d.wallpaper.selectedId=this.settings.wallpaper.selectedId;d.library=structuredClone(this.settings.library);return this.request(d)}
  setViewport(value){if(this.closed)return;const next=validateViewport(value);if(!next||JSON.stringify(next)===JSON.stringify(this.latestViewport))return;this.latestViewport=next;this.resizePending=true;clearTimeout(this.resizeTimer);this.resizeTimer=setTimeout(()=>this.flushViewport().catch(()=>{}),300)}
  async flushViewport(){
    clearTimeout(this.resizeTimer);this.resizeTimer=null;if(this.closed||this.pendingUserRequests||this.resizeJob||!this.resizePending)return;
    this.resizePending=false;const epoch=++this.renderEpoch;this.resizeAbort=new AbortController();const job=this.replaceForViewport(epoch,this.resizeAbort.signal);this.resizeJob=job;
    try{await job}finally{if(this.resizeJob===job)this.resizeJob=null;if(!this.closed&&!this.pendingUserRequests&&this.resizePending)queueMicrotask(()=>this.flushViewport().catch(()=>{}))}
  }
  async replaceForViewport(epoch,signal){
    const settings=this.settings,revision=this.revision;if(this.active?.status?.still||settings.performance.resolutionMode!=='window'||!settings.enabled||!settings.wallpaper.enabled||!settings.wallpaper.selectedId)return;
    const entry=this.library.get(settings.wallpaper.selectedId);if(entry?.capability!=='supported')return;const output=this.renderPlayback(settings),key=this.rendererKey(entry,settings,output.playback);if(this.active&&key===this.activeRequestKey)return;
    const old=this.active,oldFrame=this.paintedRenderer===old?this.paintedFrame:null;let candidate;
    const current=()=>!this.closed&&!signal.aborted&&epoch===this.renderEpoch&&revision===this.revision&&!this.pendingUserRequests&&this.hostResponsive();
    try{
      await this.commit(async()=>{if(current())await old?.pause()});if(!current())return;
      const job=this.prepareRenderer(entry,output.playback,{signal,performance:settings.performance});this.loading.add(job);job.then(()=>this.loading.delete(job),()=>this.loading.delete(job));candidate=await job;
      if(!current()){await candidate.close();return}
      const frame=await candidate.frame();if(!current()){await candidate.close();return}
      if(!this.host.supportsDecodedPaint)await this.host.validateImage(frame);
      await this.commit(async()=>{
        if(!current()){await candidate.close();return}
        try{
          await this.host.apply(settings);await candidate.setPlayback(output.playback);
          if(!current())throw new DOMException('Resize superseded','AbortError');
          if(!await this.paintConfirmed(frame,candidate))throw new Error('Resize decode failed');
          if(!current())throw new DOMException('Resize superseded','AbortError');
          await candidate.promote?.();this.active=candidate;this.activeRequestKey=key;this.activeKey=key+':'+(candidate.entryFingerprint||'')+':'+(candidate.status.backend||'');this.renderSize=output.size;this.paintedFrame=frame;this.paintedRenderer=candidate;
          if(old&&old!==candidate)await old.close();
        }catch(error){
          if(this.hostResponsive()&&this.active===old&&oldFrame){await this.host.apply(this.settings);await this.paintConfirmed(oldFrame,old)}
          throw error;
        }
      });
    }catch(error){if(candidate&&candidate!==this.active)await candidate.close().catch(()=>{});if(current()){await this.commit(async()=>{if(current()&&old===this.active&&!settings.playback.paused&&!this.outputSuspended(settings))await old?.resume()});this.error='視窗尺寸調整失敗，已保留原畫面'}}
  }
  async whenIdle(){while(!this.closed&&(this.pendingUserRequests||this.resizePending||this.resizeJob||this.resizeTimer)){if(this.resizePending&&!this.pendingUserRequests&&!this.resizeJob)await this.flushViewport();await Promise.allSettled([...this.userJobs,...(this.resizeJob?[this.resizeJob]:[])])}await this.tail}
  async tick(now=Date.now()){
    // A failed output stays paused until an explicit settings/retry request.
    // Resuming it every timer tick can repeatedly hit an unresponsive host.
    if(this.closed||this.playback.pendingId||this.playback.state==='error')return;
    const s=this.settings,wanted=s.enabled&&s.wallpaper.enabled&&s.wallpaper.selectedId;
    const idle=!wanted||s.playback.paused||this.outputSuspended(s);
    if(idle){
      if(this.samples?.length)this.samples.length=0;
      this.nextDisplayAt=0;
      if(!this.idleSince)this.idleSince=now;
      const renderer=this.active,revision=this.revision;
      const status=renderer?.status,release=!!renderer&&(!status.still||!wanted)&&now-this.idleSince>=60000;
      const state=wanted?(status?.still?'static':'paused'):'off',suspended=this.outputSuspended(s);
      if(!release&&(!renderer||status.state==='paused')&&this.playback.state===state&&this.playback.suspended===suspended)return;
      await this.commit(async()=>{
        if(this.closed||this.active!==renderer||this.revision!==revision)return;
        if(renderer&&renderer.status.state!=='paused')await renderer.pause();
        if(this.revision!==revision)return;
        if(release){await renderer.close();this.active=null;this.activeKey=null;this.activeRequestKey=null}
        if(this.playback.state!=='error')this.playback={...this.playback,state,suspended:this.outputSuspended(s)};
      });return;
    }
    this.idleSince=0;
    if(this.retryInitialRenderer){this.retryInitialRenderer=false;if(this.active?.status.preview){await this.request(s);return}}
    if(s.playback.rotationEnabled&&now-this.lastSwitch>=s.playback.rotationSeconds*1000){
      const ids=s.playback.playlist.filter(id=>!s.library.hidden.includes(id)&&this.library.get(id)?.capability==='supported');
      if(ids.length>1){const index=ids.indexOf(s.wallpaper.selectedId);this.lastSwitch=now;await this.select(ids[(index+1)%ids.length],{explicitRetry:false});return}
      this.lastSwitch=now;
    }
    if(!this.active){if(this.playback.state!=='error')await this.request(s);return}
    const activeStatus=this.active.status;
    if(activeStatus.still){this.playback={...this.playback,state:activeStatus.preview?'loading':'static',suspended:false,displayFps:0,renderFps:0,captureFps:0,staticSource:activeStatus.staticSource};return}
    if(activeStatus.state==='paused'){const renderer=this.active;await this.commit(async()=>{if(!this.closed&&renderer===this.active&&!this.playback.pendingId&&!this.settings.playback.paused&&!this.outputSuspended())await renderer.resume()});if(this.playback.pendingId||this.closed||this.outputSuspended())return}
    if(this.library.get(s.wallpaper.selectedId)?.kind==='image'){if(this.playback.state!=='playing'||this.playback.suspended!==false)this.playback={...this.playback,state:'playing',suspended:false};return}
    const renderer=this.active;let frame;try{frame=await (renderer.nextFrame?renderer.nextFrame():renderer.frame())}catch(error){if(renderer!==this.active||this.closed||this.playback.pendingId||this.outputSuspended())return;throw error}if(renderer!==this.active||this.closed||!this.settings.enabled||!this.settings.wallpaper.enabled||this.settings.playback.paused||this.outputSuspended())return;
    const {displayFps,renderFps}=s.playback;
    if(renderer.eventDriven&&displayFps<renderFps){const time=performance.now(),period=1000/displayFps;if(time<(this.nextDisplayAt||0))return;this.nextDisplayAt=!this.nextDisplayAt||time-this.nextDisplayAt>period*2?time+period:this.nextDisplayAt+period}
    const status=renderer.status;
    this.playback={...this.playback,state:'playing',suspended:false,renderFps:status.renderFps,captureFps:status.captureFps,captureMode:status.captureMode,captureDiagnostics:status.captureDiagnostics};
    if(this.paintedRenderer===renderer&&this.paintedFrame===frame)return;
    const painted=await this.commit(async()=>{if(renderer!==this.active||this.closed||!this.settings.enabled||!this.settings.wallpaper.enabled||this.settings.playback.paused||this.playback.pendingId||this.outputSuspended())return false;try{if(await this.paint(frame,renderer)===false)return false}catch(error){if(!this.hostResponsive())return false;throw error}this.paintedFrame=frame;this.paintedRenderer=renderer;return true});if(!painted)return;
    const time=Date.now();this.samples??=[];this.samples.push(time);if(this.samples.length>20)this.samples.shift();if(this.samples.length>1)this.playback.displayFps=Math.round((this.samples.length-1)*10000/(time-this.samples[0]))/10;
  }
  loopDelay(elapsed=0){
    const s=this.settings,wanted=s.enabled&&s.wallpaper.enabled&&s.wallpaper.selectedId;
    // Settings requests are applied directly; no need to poll idle/static images at video FPS.
    if(!wanted||s.playback.paused||this.outputSuspended(s)||this.playback.pendingId||this.playback.state==='error')return Math.max(0,250-elapsed);
    if(this.active?.status?.still||this.library.get(s.wallpaper.selectedId)?.kind==='image')return Math.max(0,500-elapsed);
    if(this.active?.eventDriven)return 0;
    return Math.max(0,1000/Math.min(s.playback.displayFps,s.playback.renderFps)-elapsed);
  }
  async run(){while(!this.closed){const then=Date.now();try{await this.tick()}catch(e){if(this.hostResponsive()&&e.code!=='HOST_UNRESPONSIVE'){this.error=e.message;this.failure={retryBlocked:e.retryBlocked===true,retryManaged:e.retryManaged===true};this.playback={...this.playback,state:'error',error:e.message};await this.active?.pause().catch(()=>{})}}const wait=this.loopDelay(Date.now()-then);if(wait>0)await delay(wait)}}
  refreshHost({imageMissing=false}={}){return this.commit(async()=>{
    if(this.closed||!this.hostResponsive())return;
    const sample=this.host.synchronize?await this.host.synchronize(this.settings,{includeDiagnostics:false}):null;
    if(!this.hostResponsive())return;
    if(!this.settings.enabled){if(!sample)await this.host.restoreAll();return sample}
    if(!sample)await this.host.apply(this.settings);
    if(!this.hostResponsive())return;
    if((sample?sample.imageMissing:imageMissing)&&this.settings.wallpaper.enabled&&this.active){
      const frame=this.paintedRenderer===this.active&&this.paintedFrame?this.paintedFrame:await this.active.frame();
      if(!this.hostResponsive())return;
      if(!await this.paintConfirmed(frame,this.active))throw new Error('Wallpaper refresh did not decode');
      this.paintedFrame=frame;this.paintedRenderer=this.active;
      if(sample&&this.host.confirmApplied)sample.proof=await this.host.confirmApplied(this.settings);
    }
    return sample;
  })}

  async close({preserveFrame=false,retainFrame}={}){
    if(this.closed)return;this.closed=true;this.revision++;this.renderEpoch++;clearTimeout(this.resizeTimer);this.resizeAbort?.abort();this.pendingAbort?.abort();await Promise.allSettled([...this.loading,...this.userJobs,...(this.resizeJob?[this.resizeJob]:[])]);await this.tail;await this.active?.close();await this.loop;
    if(preserveFrame){await retainFrame?.(this.paintedFrame);return {restored:null}}
    if(!this.hostResponsive())return {restored:false,error:'HOST_UNRESPONSIVE'};
    try{await this.host.restoreAll();return {restored:true}}catch(e){return {restored:false,error:e.message}}
  }
}
module.exports={WallpaperController};
