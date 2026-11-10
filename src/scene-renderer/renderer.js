/* Host adapter inspired by dsh-plugin-wallpaper-engine (MIT); engine: WebWallGL 3.0.0 (MIT). */
const status={state:'loading',error:null,diagnostics:[]};
window.codexSceneStatus=status;
// Compositor capture owns the displayed frame. Retaining every WebGL drawing
// buffer adds a GPU copy; fallback capture also uses the compositor.
const getContext=HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext=function(kind,options){return getContext.call(this,kind,kind==='webgl2'||kind==='webgl'?{...options,preserveDrawingBuffer:false}:options)};
async function boot(){
  const response=await fetch('render-config.json');let bootstrap=null;
  if(response.status!==404){if(!response.ok)throw new Error('Renderer bootstrap unavailable');bootstrap=await response.json();if(typeof bootstrap.leaseId!=='string'||typeof bootstrap.sourceKey!=='string'||!bootstrap.sourceKey.startsWith('codex:')||bootstrap.assetBase!==new URL('.',location.href).href||!bootstrap.playback||!bootstrap.cachePolicy)throw new Error('Invalid renderer bootstrap')}
  window.codexRendererBootstrap=bootstrap;
  const project=await(await fetch('project.json')).json();
  if(project.type==='video'||project.type==='image'){await bootMedia(project);publishProof(bootstrap);return}
  let cacheEnabled=false;
  if(bootstrap?.cachePolicy.enabled){try{for(const name of ['cache-policy.js','cache-index.js','cache-adapter.js'])await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=new URL(name,bootstrap.assetBase).href;script.onload=resolve;script.onerror=()=>reject(new Error('Cache adapter unavailable'));document.head.append(script)});await installCacheAdapter(bootstrap.cachePolicy);cacheEnabled=true}catch{status.cacheReason='CACHE_UNAVAILABLE'}}
  const instance=WebWallGL.createScene(document.getElementById('scene'),{fps:bootstrap?.playback.renderFps||30,volume:0,renderDpr:1,videoTexScale:1,autoQuality:false,quality:{particles:bootstrap?.playback.qualityMode==='low'?'low':bootstrap?.playback.qualityMode==='balanced'?'medium':'high',postProcessing:bootstrap?.playback.qualityMode==='low'?'off':bootstrap?.playback.qualityMode==='balanced'?'low':'high'},bake:cacheEnabled,audio:null,media:null,properties:{dayntime:false,soundbar1:0},onDiagnostic:(message,level)=>{if(level==='error'||level==='warn'){status.diagnostics.push(String(message).slice(0,240));status.diagnostics=status.diagnostics.slice(-6)}}});
  window.codexScene=instance;
  try{const gl=instance.canvas.getContext('webgl2')||instance.canvas.getContext('webgl'),extension=gl?.getExtension('WEBGL_debug_renderer_info'),name=String(extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):'');window.codexRendererGpuClass=/AMD|Radeon/i.test(name)?'AMD':/NVIDIA/i.test(name)?'NVIDIA':/Intel/i.test(name)?'Intel':/SwiftShader|software|llvmpipe/i.test(name)?'software':'unknown'}catch{window.codexRendererGpuClass='unknown'}
  instance.on('error',e=>{status.state='error';status.error=String(e?.message||e)});
  const source=WebWallGL.httpSource(bootstrap?.assetBase||new URL('.',location.href).href);
  await instance.load(bootstrap?{...source,key:bootstrap.sourceKey}:source);instance.setProperties({dayntime:false,soundbar1:0});status.state='ready';publishProof(bootstrap);
  window.addEventListener('pagehide',()=>instance.destroy());
}
function publishProof(bootstrap){if(bootstrap)window.codexSceneProof={leaseId:bootstrap.leaseId,url:location.href,token:String(performance.timeOrigin),width:codexScene.canvas.width,height:codexScene.canvas.height}}
async function bootMedia(project){
  const video=project.type==='video',media=document.createElement(video?'video':'img'),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{alpha:false});
  document.getElementById('scene').append(canvas);let paused=false,rate=30,raf=0,last=0,tick=performance.now(),count=0,fps=0;
  if(video){media.muted=true;media.volume=0;media.loop=true;media.playsInline=true;media.preload='auto'}
  function draw(now){
    if(now-last>=1000/rate){last=now;const w=video?media.videoWidth:media.naturalWidth,h=video?media.videoHeight:media.naturalHeight;if(w&&h){
      // Preserve the complete source aspect. The host applies cover/contain/focus once.
      const scale=Math.min(innerWidth/w,innerHeight/h),width=Math.max(1,Math.round(w*scale)),height=Math.max(1,Math.round(h*scale));
      if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height}
      ctx.drawImage(media,0,0,canvas.width,canvas.height);count++
    }if(now-tick>=1000){fps=count*1000/(now-tick);count=0;tick=now}}
    if(!paused&&video)raf=requestAnimationFrame(draw);
  }
  window.codexScene={canvas,get paused(){return paused},get stats(){return {fps,running:!paused}},setFps(value){rate=value},setVolume(value){if(video){media.volume=value;media.muted=value===0}},pause(){paused=true;cancelAnimationFrame(raf);if(video)media.pause()},resume(){if(!paused)return;paused=false;if(video)media.play().catch(e=>{status.state='error';status.error=e.message});raf=requestAnimationFrame(draw)}};
  await new Promise((resolve,reject)=>{media.addEventListener(video?'loadeddata':'load',resolve,{once:true});media.addEventListener('error',()=>reject(new Error('影片編碼或圖片無法解碼')),{once:true});media.src=project.file});
  if(video)await media.play();draw(performance.now()+1000);status.state='ready';
  media.addEventListener('error',()=>{status.state='error';status.error='媒體播放失敗'});
  window.addEventListener('pagehide',()=>{cancelAnimationFrame(raf);if(video){media.pause();media.removeAttribute('src');media.load()}});
}
boot().catch(e=>{status.state='error';status.error=String(e?.message||e)});
