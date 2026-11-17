const MAX_RENDER_WIDTH = 3840;
const MAX_RENDER_HEIGHT = 2160;

function validateViewport(value){
 if(!value||value.visible!==true||!Number.isFinite(value.cssWidth)||!Number.isFinite(value.cssHeight)||value.cssWidth<=0||value.cssHeight<=0||value.cssWidth>32768||value.cssHeight>32768||!Number.isFinite(value.dpr)||value.dpr<.25||value.dpr>8)return null;
 return {cssWidth:value.cssWidth,cssHeight:value.cssHeight,dpr:value.dpr,visible:true,documentToken:typeof value.documentToken==='string'?value.documentToken:null};
}
function resolveRenderSize({playback,performance,viewport}){
 const manual=performance.resolutionMode==='manual',current=manual?null:validateViewport(viewport);
 const requested=current
  ?{width:Math.max(1,Math.round(current.cssWidth*current.dpr)),height:Math.max(1,Math.round(current.cssHeight*current.dpr))}
  :{width:playback.width,height:playback.height};
 const cap=performance.qualityMode==='low'?960:performance.qualityMode==='balanced'?1280:1920;
 const maxWidth=manual?MAX_RENDER_WIDTH:cap,maxHeight=manual?MAX_RENDER_HEIGHT:cap*9/16;
 const scale=Math.min(1,maxWidth/requested.width,maxHeight/requested.height);
 return {width:Math.max(1,Math.round(requested.width*scale)),height:Math.max(1,Math.round(requested.height*scale)),limited:scale<1,requested};
}

function resolvePlayback(settings,viewport){
 const size=resolveRenderSize({playback:settings.playback,performance:{...settings.performance,qualityMode:'fixed'},viewport});
 return {size,playback:{...settings.playback,powerSaving:settings.performance.powerSaving,width:size.width,height:size.height,qualityMode:'fixed',captureQuality:92}};
}
module.exports={validateViewport,resolveRenderSize,resolvePlayback,MAX_RENDER_WIDTH,MAX_RENDER_HEIGHT};
