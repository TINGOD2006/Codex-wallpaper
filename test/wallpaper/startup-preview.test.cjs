const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createWallpaperRuntime}=require('../../src/wallpaper/runtime.cjs'),{createStore}=require('../../src/wallpaper/store.cjs'),{defaults}=require('../../src/wallpaper/schema.cjs');
const CACHED='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=';
test('startup paints only a matching cached wallpaper before preparing the live renderer',async()=>{
 for(const match of [true,false]){
  const dataRoot=await fs.mkdtemp(path.join(os.tmpdir(),'cw-preview-')),store=createStore(dataRoot),s=defaults();s.wallpaper.selectedId='selected';await store.save(s);await fs.writeFile(path.join(dataRoot,'last-wallpaper-frame.json'),JSON.stringify({selectedId:match?'selected':'other',uri:CACHED}));const events=[];
  class Host{async inspect(){return {rootViewportCount:0,frameCount:1,activeMainSurfaceCount:1,composerBodyCount:1,editorCount:1,mode:'codex'}}async validateImage(){}async apply(){}async paint(uri){events.push(uri)}async clearBackground(){}async restoreAll(){}async confirmImage(){return true}}
  const entry={id:'selected',kind:'image',capability:'supported'},library={scan:async()=>{throw Error('Companion already scanned the library')},get:()=>entry,cards:()=>[]},rendererService={prepare:async()=>{events.push('prepare');return {status:{state:'ready'},frame:async()=>'live',setPlayback:async()=>{},close:async()=>{},pause:async()=>{},resume:async()=>{}}}};
  const runtime=await createWallpaperRuntime({client:{evaluate:async()=>true},identity:{sessionId:'preview',appVersion:'26.1027.6604.0'},projectRoot:path.resolve('.'),dataRoot,mountPanel:false,Host,services:{store,library,presets:{},rendererService}});
  try{assert.deepEqual(events,match?[CACHED,'prepare','live']:['prepare','live'])}finally{await runtime.close()}
 }
});

async function sceneFixture({rejectFrame=false}={}){
 const dataRoot=await fs.mkdtemp(path.join(os.tmpdir(),'cw-scene-preview-')),store=createStore(dataRoot),s=defaults();s.wallpaper.selectedId='scene';await store.save(s);const cache=path.join(dataRoot,'last-wallpaper-frame.json');await fs.writeFile(cache,JSON.stringify({selectedId:'scene',uri:CACHED}));
 let resolve,reject,prepared=0,image=null,restored=0;const gate=new Promise((a,b)=>{resolve=a;reject=b}),LIVE='data:image/jpeg;base64,YQ==';
 class Host{
  async inspect(){return {rootViewportCount:0,frameCount:1,activeMainSurfaceCount:1,composerBodyCount:1,editorCount:1,mode:'codex'}}
  async validateImage(uri){if(rejectFrame&&uri===LIVE)throw Error('Invalid first live frame')}
  async apply(){}async paint(uri){image=uri;return true}async clearBackground(){image=null}async restoreAll(){image=null;restored++}async confirmImage(uri){return image===uri}async confirmApplied(){return {stylesConfirmed:true,imageConfirmed:!!image}}
 }
 const entry={id:'scene',kind:'scene',capability:'supported'},library={get:id=>id==='scene'?entry:null,cards:()=>[]},renderer={status:{state:'ready'},frame:async()=>LIVE,setPlayback:async()=>{},close:async()=>{},pause:async()=>{},resume:async()=>{}},rendererService={prepare:async(entry,playback,{signal})=>{prepared++;signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true});await gate;return renderer},observeReceiver(){},refresh:async()=>{}};
 return {dataRoot,store,cache,LIVE,get image(){return image},get prepared(){return prepared},get restored(){return restored},resolve,reject,options:{client:{evaluate:async()=>true},identity:{sessionId:'staged',appVersion:'26.1027.6604.0'},projectRoot:path.resolve('.'),dataRoot,mountPanel:false,Host,services:{store,library,presets:{},rendererService}}};
}
test('a decoded static scene makes the runtime ready while dynamic preparation remains blocked, then promotes the live frame',async()=>{
 const f=await sceneFixture(),runtime=await Promise.race([createWallpaperRuntime(f.options),new Promise((_,reject)=>setTimeout(()=>reject(Error('Static startup waited for live renderer')),1000))]);
 try{assert.equal(f.prepared,1);assert.equal(f.image,CACHED);assert.equal(runtime.controller.playback.preview,true);assert.equal(runtime.controller.playback.state,'loading');assert.equal(runtime.status().observedApplied,true);f.resolve();await runtime.controller.initialRequest;assert.equal(f.image,f.LIVE);assert.equal(runtime.controller.playback.state,'playing');assert.notEqual(runtime.controller.playback.preview,true)}finally{await runtime.close()}
 assert.equal(JSON.parse(await fs.readFile(f.cache,'utf8')).uri,f.LIVE);
});
test('renderer and first-frame failures preserve the static picture, visible error and disabled retry budget',async()=>{
 for(const rejectFrame of [false,true]){const f=await sceneFixture({rejectFrame}),runtime=await createWallpaperRuntime(f.options);try{if(rejectFrame)f.resolve();else f.reject(Error('Renderer failed'));await runtime.controller.initialRequest;await runtime.controller.tick();await runtime.refresh();assert.equal(f.image,CACHED);assert.equal(f.restored,0);assert.equal(runtime.controller.playback.preview,true);assert.equal(runtime.controller.playback.state,'error');assert.ok(runtime.controller.error);assert.equal(runtime.status().observedApplied,true);assert.equal(JSON.parse(await fs.readFile(f.cache,'utf8')).uri,CACHED)}finally{await runtime.close()}}
});
test('closing or disabling while dynamic preload is pending aborts it without late promotion',async()=>{
 for(const disable of [false,true]){const f=await sceneFixture(),runtime=await createWallpaperRuntime(f.options);if(disable){await runtime.controller.patch({enabled:false});await runtime.controller.initialRequest;assert.equal(f.image,null);assert.equal(runtime.controller.settings.enabled,false)}await runtime.close();assert.equal(f.image,null);assert.ok(f.restored>0)}
});
test('preloaded candidates are decoded in authority order, fall back from corrupt cache and cannot cross wallpaper IDs',async()=>{
 const {preloadSceneStill,resolveSceneStill}=require('../../src/wallpaper/scene-still.cjs'),root=await fs.mkdtemp(path.join(os.tmpdir(),'cw-preloaded-')),preview=path.join(root,'preview.png'),bad='data:image/jpeg;base64,YQ==';await fs.writeFile(preview,Buffer.from(CACHED.split(',')[1],'base64'));await fs.writeFile(path.join(root,'last-wallpaper-frame.json'),JSON.stringify({selectedId:'a',uri:bad}));
 const entry={id:'a',directory:root,previewPath:preview},preloaded={selectedId:'a',candidates:await preloadSceneStill({entry,dataRoot:root})};assert.deepEqual(preloaded.candidates.map(c=>c.source),['cache','preview']);await fs.unlink(preview);await fs.unlink(path.join(root,'last-wallpaper-frame.json'));const seen=[];
 const value=await resolveSceneStill({entry,dataRoot:root,preloaded,validate:async uri=>{seen.push(uri);if(uri===bad)throw Error('Bad cache')}});assert.equal(value.source,'preview');assert.deepEqual(seen,[bad,CACHED]);assert.equal((await resolveSceneStill({entry:{id:'b'},dataRoot:root,preloaded})).source,'empty');
});
