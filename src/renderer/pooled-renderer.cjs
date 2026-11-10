const {FrameStream}=require('../frame-stream.cjs'),{jpegDimensions}=require('../jpeg-frame.cjs'),{delay}=require('../control.cjs'),{checkAbort,renderError}=require('./errors.cjs');
const sample=`(()=>{ /* RENDERER_SAMPLE */ const scene=window.codexScene;return {url:location.href,token:String(performance.timeOrigin),proof:window.codexSceneProof,state:window.codexSceneStatus,stats:scene?.stats,paused:scene?.paused,width:scene?.canvas?.width,height:scene?.canvas?.height,gpu:window.codexRendererGpuClass||null,bake:window.__memStats?.().bake||scene?.info?.bake}})()`;
class PooledRenderer{
 constructor({target,registration,playback,identity,cachePolicy={enabled:false},kind='scene',streamFactory=client=>new FrameStream(client,playback)}){Object.assign(this,{target,registration,playback,kind,...identity});this.client=target.client;this.streamFactory=streamFactory;this.status={state:'loading',backend:'pool',frames:0,cacheAllowed:cachePolicy.enabled===true,cacheEpoch:cachePolicy.epoch??null};this.tail=Promise.resolve();this.invalid=null;this.listener=event=>{if(event.method==='Page.frameNavigated'&&!event.params.frame.parentId&&(this.documentToken||event.params.frame.url!==registration.rendererUrl))this.invalidate('LEASE_DOCUMENT_CHANGED')};this.disconnected=()=>this.invalidate('POOL_LOST');this.client.on('notification',this.listener);this.client.on('disconnected',this.disconnected)}
 onInvalidated(listener){this.healthListeners??=new Set();this.healthListeners.add(listener);return()=>this.healthListeners.delete(listener)}
 invalidate(code){if(this.closed||this.invalid)return;this.invalid=code;this.status={...this.status,state:'error',error:code};this.stream?.stop().catch(()=>{});for(const listener of this.healthListeners||[])try{listener(code)}catch{}}
 assertCurrent(value){if(this.invalid)throw renderError(this.invalid);if(this.closed)throw renderError('POOL_CLOSED');if(!this.client.connected)throw renderError('POOL_LOST');if(value&&(value.url!==this.registration.rendererUrl||value.proof?.url!==value.url||value.proof?.leaseId!==this.registration.leaseId||value.proof?.token!==value.token||(this.documentToken&&value.token!==this.documentToken))){this.invalidate('LEASE_DOCUMENT_CHANGED');throw renderError('LEASE_DOCUMENT_CHANGED')}}
 async start(signal){
  try{checkAbort(signal);await this.client.send('Page.enable');const {width,height}=this.playback;await this.client.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
   let ready;
   for(let i=0;i<160;i++){checkAbort(signal);this.assertCurrent();const s=await this.client.evaluate(sample);if(s?.state?.state==='error')throw new Error('Renderer source failed');if(s?.state?.state==='ready'&&s.proof){this.assertCurrent(s);ready=s;break}await delay(250)}
   if(!ready)throw renderError('POOL_UNAVAILABLE');this.documentToken=ready.token;
   await this.client.evaluate(`(()=>{codexScene.setFps(${this.playback.renderFps});codexScene.setVolume(${this.playback.muted?0:this.playback.volume})})()`);
   if(this.kind==='scene'){this.stream=this.streamFactory(this.client);try{await this.stream.start()}catch(error){await this.stream.close();this.stream=null;this.status.captureFallback='COMPOSITOR_FALLBACK';checkAbort(signal)}}
   this.status={...this.status,state:'ready',backend:'pool',captureMode:this.stream?'screencast':this.kind==='scene'?'screenshot':'canvas',sourceSize:{width:ready.width||ready.proof.width,height:ready.height||ready.proof.height},quality:{renderDpr:1,videoTexScale:1,particles:this.playback.qualityMode==='low'?'low':this.playback.qualityMode==='balanced'?'medium':'high',postProcessing:this.playback.qualityMode==='low'?'off':this.playback.qualityMode==='balanced'?'low':'high',autoQuality:false,jpeg:this.playback.captureQuality||92}};
   await this.frame();checkAbort(signal);return this;
  }catch(error){await this.close();throw error}
 }
 get eventDriven(){return this.stream?.active===true}
 async nextFrame(){if(this.stream)try{await this.stream.next()}catch(error){this.assertCurrent();await this.stream.close();this.stream=null;this.status.captureMode='screenshot'}return this.frame()}
 recordSample(s){this.assertCurrent(s);if(s?.state?.state==='error')throw new Error('Renderer source failed');this.status.renderFps=Math.round(s.stats?.fps||0);this.status.bake=s.bake||null;this.status.gpu=s.gpu||null;this.status.cacheReason=s.state?.cacheReason||null;this.sourceSize={width:s.width||s.proof.width,height:s.height||s.proof.height}}
 async frame(){
  this.assertCurrent();if(this.stream?.failure){await this.stream.close();this.stream=null;this.status.captureMode='screenshot'}let image;
  if(this.stream?.frame){image=this.stream.frame;if(!this.statsJob&&Date.now()-(this.lastStats||0)>1000){this.lastStats=Date.now();this.statsJob=this.client.evaluate(sample).then(s=>this.recordSample(s)).catch(error=>{this.invalidate(error.code||'POOL_LOST')}).finally(()=>{this.statsJob=null})}}
  else{const s=await this.client.evaluate(this.kind==='scene'?sample:sample.replace('bake:window.__memStats?.().bake||scene?.info?.bake',`bake:window.__memStats?.().bake||scene?.info?.bake,image:scene?.canvas?.toDataURL("image/jpeg",${(this.playback.captureQuality||92)/100})`));this.recordSample(s);if(this.kind==='scene'){const {width,height}=this.playback,result=await this.client.send('Page.captureScreenshot',{format:'jpeg',quality:this.playback.captureQuality||92,fromSurface:true,captureBeyondViewport:true,clip:{x:0,y:0,width,height,scale:1}});image='data:image/jpeg;base64,'+result.data}else image=s.image}
  this.assertCurrent();if(typeof image!=='string'||!image.startsWith('data:image/jpeg;base64,'))throw renderError('FRAME_DIMENSION_MISMATCH');
  if(!this.validatedSize||!this.stream){const size=jpegDimensions(image.slice(23)),expected=this.kind==='scene'?this.playback:this.sourceSize;if(!size||size.width!==expected.width||size.height!==expected.height)throw Object.assign(renderError('FRAME_DIMENSION_MISMATCH'),{dimensions:{expected:{width:expected.width,height:expected.height},actual:size}});this.validatedSize=size;this.status.outputSize=size}
  this.status={...this.status,frames:this.status.frames+1,captureFps:this.stream?.fps||null};return image;
 }
 operation(work){if(this.closed)return Promise.resolve();const job=this.tail.then(()=>{this.assertCurrent();return work()});this.tail=job.catch(()=>{});return job}
 pause(){return this.operation(async()=>{await this.client.evaluate('codexScene.pause()');await this.stream?.stop();this.status.state='paused'})}
 resume(){return this.operation(async()=>{await this.client.evaluate('codexScene.resume()');await this.stream?.start();this.status.state='ready'})}
 setPlayback(value){return this.operation(async()=>{this.playback={...this.playback,...value};await this.client.evaluate(`(()=>{codexScene.setFps(${value.renderFps});codexScene.setVolume(${value.muted?0:value.volume});codexScene.${value.paused?'pause':'resume'}()})()`);if(this.stream){await this.stream.configure(value);if(value.paused)await this.stream.stop();else await this.stream.start()}this.status.state=value.paused?'paused':'ready'})}
 close(){if(this.closing)return this.closing;this.closed=true;this.closing=(async()=>{await this.tail;await this.stream?.close();this.client.off('notification',this.listener);this.client.off('disconnected',this.disconnected);try{await this.target.close()}finally{await this.registration.revoke();this.status.state='stopped'}})();return this.closing}
}
async function createPooledRenderer(options){return new PooledRenderer(options).start(options.signal)}
async function probeCapabilities(owner,origin,{durationMs=15000}={}){
 const targets=[],streams=[];
 try{
  await owner.start();for(const [width,height]of [[640,400],[800,500]]){const target=await owner.openTarget({url:origin.openProbe(),width,height});targets.push(target);await target.client.send('Page.enable');const stream=new FrameStream(target.client,{width,height,renderFps:30,displayFps:30});streams.push(stream);await stream.start()}
  const before=await Promise.all(targets.map(t=>t.client.evaluate('window.codexRendererProbe?.frames||0')));await delay(durationMs);const after=await Promise.all(targets.map(t=>t.client.evaluate('({frames:window.codexRendererProbe?.frames||0,cacheApi:!!window.caches,webLocks:!!navigator.locks,indexedDB:!!window.indexedDB})')));
  const completeFrames=streams.every((s,i)=>{const size=jpegDimensions(s.frame?.slice(23));return size?.width===[640,800][i]&&size?.height===[400,500][i]});const multiWindow=after.every((s,i)=>s.frames>before[i]+10&&streams[i].sequence>2);
  if(!completeFrames||!multiWindow)throw renderError('POOL_TARGET_UNSUPPORTED');return {completeFrames,multiWindow,cacheApi:after.every(s=>s.cacheApi),webLocks:after.every(s=>s.webLocks),indexedDB:after.every(s=>s.indexedDB)};
 }catch(error){if(error.code==='OWNER_MISMATCH')throw error;throw renderError('POOL_TARGET_UNSUPPORTED',error)}finally{for(const stream of streams)await stream.close();for(const target of targets)await target.close()}
}
module.exports={PooledRenderer,createPooledRenderer,probeCapabilities};
