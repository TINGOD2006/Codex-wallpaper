const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),vm=require('node:vm');
test('fresh and reset playback defaults use Full HD without overwriting explicit saved resolutions',()=>{
 const {defaults,mergeSettings,validateSettings}=require('../../src/wallpaper/schema.cjs'),settings=defaults();assert.deepEqual([settings.playback.width,settings.playback.height],[1920,1080]);
 const explicit=mergeSettings(settings,{playback:{width:1024,height:660}});assert.deepEqual([validateSettings(explicit).playback.width,validateSettings(explicit).playback.height],[1024,660]);
});
test('scene quality stays explicit and compositor capture avoids retained WebGL buffers',async()=>{
 const code=await fs.readFile(path.resolve(__dirname,'../../src/scene-renderer/renderer.js'),'utf8');let options,context;
 class Canvas{getContext(kind,value){context={kind,value};return {}}}
 const canvas=new Canvas(),instance={canvas,on(){},async load(){},setProperties(){},destroy(){}};
 const sandbox={HTMLCanvasElement:Canvas,fetch:async url=>url==='render-config.json'?{status:404}:{json:async()=>({type:'scene'})},document:{getElementById:()=>({})},location:{href:'http://127.0.0.1:1234/fixture/'},URL,WebWallGL:{createScene(_host,value){options=value;canvas.getContext('webgl2',{preserveDrawingBuffer:true});return instance},httpSource:x=>x},addEventListener(){}};sandbox.window=sandbox;
 vm.runInNewContext(code,sandbox);await new Promise(setImmediate);
 assert.equal(sandbox.codexSceneStatus.state,'ready');assert.equal(options.autoQuality,false);assert.equal(options.renderDpr,1);assert.equal(options.videoTexScale,1);assert.equal(options.quality.postProcessing,'high');assert.equal(options.quality.particles,'high');assert.equal(context.value.preserveDrawingBuffer,false);
});
