const path=require('node:path'),assert=require('node:assert/strict');
const {prepareRenderer}=require('../../src/wallpaper/renderer.cjs'),{defaults}=require('../../src/wallpaper/schema.cjs');
(async()=>{
 const entry={id:'fixture:edge-marks',kind:'video',directory:path.resolve('test/wallpaper/fixtures'),mediaPath:path.resolve('test/wallpaper/fixtures/edge-marks.webm'),title:'Synthetic portrait with edge markers',capability:'supported'};
 const r=await prepareRenderer(entry,{...defaults().playback,width:640,height:360});
 try{
  const frame=await r.client.evaluate(`(()=>{const c=codexScene.canvas,x=c.getContext('2d'),pixel=(a,b)=>[...x.getImageData(a,b,1,1).data];return {width:c.width,height:c.height,top:pixel(c.width/2,2),bottom:pixel(c.width/2,c.height-3),left:pixel(2,c.height/2),right:pixel(c.width-3,c.height/2)}})()`);
  assert.equal(frame.width/frame.height,.5,'Bridge must preserve the complete portrait aspect, leaving host fit/focus in control');assert.ok(frame.width<=640&&frame.height<=360);
  assert.ok(frame.top[0]>200&&frame.top[1]<60&&frame.top[2]<60);assert.ok(frame.bottom[2]>200&&frame.bottom[0]<60);assert.ok(frame.left[1]>200&&frame.left[0]<60);assert.ok(frame.right[0]>200&&frame.right[1]>200);
  console.log(JSON.stringify({pass:true,frame,allEdgesPreserved:true}));
 }finally{await r.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
