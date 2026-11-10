const {loadImage}=require('../config.cjs');
const {SceneEngine}=require('../scene-engine.cjs');
async function prepareRenderer(entry,playback,{signal,runtimeRoot,still}={}){
  const cancelled=()=>{if(signal?.aborted)throw new Error('Wallpaper load cancelled')};cancelled();
  if(require('./scene-still.cjs').usesStill(entry,playback))return require('./scene-still.cjs').createStillRenderer(still);
  if(!entry||entry.capability!=='supported')throw new Error(entry?.reason||'Wallpaper is unavailable');
  if(entry.kind==='image'){
    const image=await loadImage(entry.mediaPath);cancelled();let status={state:'ready',kind:'image'};
    return {get status(){return status},frame:async()=>image.dataUri,pause:async()=>{status={...status,state:'paused'}},resume:async()=>{status={...status,state:'ready'}},setPlayback:async()=>{},close:async()=>{status={...status,state:'stopped'}}};
  }
  if(!['scene','video'].includes(entry.kind))throw new Error('Unsupported wallpaper kind');
  const engine=new SceneEngine({...playback,entry,signal,runtimeRoot,wallpaperDirectory:entry.directory});
  try{await engine.start();cancelled();await engine.setPlayback(playback);cancelled();signal?.removeEventListener('abort',engine.abortListener);engine.abortListener=null;return engine}catch(e){await engine.close();throw e}
}
async function renderPoster(entry,{signal,runtimeRoot}={}){
  const engine=new SceneEngine({entry,signal,runtimeRoot,wallpaperDirectory:entry.directory,renderFps:20,width:320,height:240});
  try{await engine.start();return await engine.frame()}finally{await engine.close()}
}
module.exports={prepareRenderer,renderPoster};
