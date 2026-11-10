function validateViewport(value){
 if(!value||value.visible!==true||!Number.isFinite(value.cssWidth)||!Number.isFinite(value.cssHeight)||value.cssWidth<=0||value.cssHeight<=0||value.cssWidth>32768||value.cssHeight>32768||!Number.isFinite(value.dpr)||value.dpr<.25||value.dpr>8)return null;
 return {cssWidth:value.cssWidth,cssHeight:value.cssHeight,dpr:value.dpr,visible:true,documentToken:typeof value.documentToken==='string'?value.documentToken:null};
}
function resolveRenderSize({playback,performance,viewport}){
 const current=performance.resolutionMode==='window'?validateViewport(viewport):null,requested=current?{width:Math.max(1,Math.round(current.cssWidth*current.dpr)),height:Math.max(1,Math.round(current.cssHeight*current.dpr))}:{width:playback.width,height:playback.height},cap=performance.qualityMode==='low'?960:performance.qualityMode==='balanced'?1280:1920,scale=Math.min(1,cap/requested.width,(cap*9/16)/requested.height);
 return {width:Math.max(1,Math.round(requested.width*scale)),height:Math.max(1,Math.round(requested.height*scale)),limited:scale<1,requested};
}
module.exports={validateViewport,resolveRenderSize};
