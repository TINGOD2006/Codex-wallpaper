const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {defaults,mergeSettings}=require('../../src/wallpaper/schema.cjs'),{createStore}=require('../../src/wallpaper/store.cjs'),{ensureSettingsV2}=require('../../src/wallpaper/settings-migration.cjs');
const {WallpaperController}=require('../../src/wallpaper/controller.cjs'),{resolveSceneStill,createStillRenderer}=require('../../src/wallpaper/scene-still.cjs');
const URI='data:image/png;base64,YQ==';
test('old v2 settings gain only the scene switch and preserve original bytes before first save',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'scene-migrate-')),settings=defaults();delete settings.playback.sceneLive;settings.enabled=false;settings.playback.paused=true;settings.playback.renderFps=20;settings.playback.displayFps=15;
 const raw=JSON.stringify(settings);await fs.writeFile(path.join(root,'user-settings.json'),raw);const store=createStore(root),upgraded=await store.load();assert.equal(upgraded.playback.sceneLive,true);delete upgraded.playback.sceneLive;assert.deepEqual(upgraded,settings);assert.equal(await fs.readFile(path.join(root,'user-settings.json'),'utf8'),raw);
 const migrated=await ensureSettingsV2(root);assert.equal(migrated.migrated,true);assert.equal(await fs.readFile(migrated.backupFile,'utf8'),raw);assert.equal((await ensureSettingsV2(root)).migrated,false);
});
test('still resolution never uses another selected wallpaper and prefers validated current frame',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'scene-still-')),entry={id:'a',directory:root};
 await fs.writeFile(path.join(root,'last-wallpaper-frame.json'),JSON.stringify({selectedId:'b',uri:URI}));
 assert.equal((await resolveSceneStill({entry,dataRoot:root})).source,'empty');
 const captured=await resolveSceneStill({entry,dataRoot:root,preferredFrame:URI});assert.equal(captured.source,'captured');assert.equal((await resolveSceneStill({entry,dataRoot:root})).source,'cache');
 assert.equal((await resolveSceneStill({entry,dataRoot:root,validate:async()=>{throw Error('bad decode')}})).source,'empty');
 const abort=new AbortController();abort.abort();await assert.rejects(resolveSceneStill({entry,dataRoot:root,signal:abort.signal}),{name:'AbortError'});
});
test('a safe preview is used after bad cache data, and preview paths outside the source are rejected',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'scene-preview-')),data=path.join(root,'data'),dir=path.join(root,'source');await fs.mkdir(data);await fs.mkdir(dir);
 const empty=await resolveSceneStill({entry:{id:'none'},dataRoot:data}),png=path.join(dir,'preview.png');await fs.writeFile(png,Buffer.from(empty.uri.split(',')[1],'base64'));
 await fs.writeFile(path.join(data,'last-wallpaper-frame.json'),JSON.stringify({selectedId:'a',uri:'data:image/jpeg;base64,YQ=='}));
 const validate=async uri=>{if(uri.startsWith('data:image/jpeg'))throw Error('bad cache')};
 assert.equal((await resolveSceneStill({entry:{id:'a',directory:dir,previewPath:png},dataRoot:data,validate})).source,'preview');
 assert.equal((await resolveSceneStill({entry:{id:'a',directory:data,previewPath:png},dataRoot:data,validate})).source,'empty');
});
async function fixture(){
 const store=createStore(await fs.mkdtemp(path.join(os.tmpdir(),'scene-control-'))),entries=new Map([['a',{id:'a',kind:'scene',capability:'supported'}],['b',{id:'b',kind:'video',capability:'supported'}],['c',{id:'c',kind:'scene',capability:'supported'}]]),live=[],optionsSeen=[];let rejectLive=false;
 const host={image:null,apply:async()=>{},restoreAll:async()=>{},clearBackground:async()=>{},validateImage:async()=>{},paint:async uri=>{host.image=uri},confirmImage:async()=>true};
 const controller=new WallpaperController({store,library:{get:id=>entries.get(id)},host,prepareRenderer:async(entry,playback,options)=>{
  optionsSeen.push({entry,playback,options});if(entry.kind==='scene'&&!playback.sceneLive)return createStillRenderer({uri:options.stillFrame||URI,source:options.stillFrame?'captured':'preview'});
  if(rejectLive)throw Error('live failure');const renderer={status:{state:'ready'},closed:0,frames:0,playbacks:[],frame:async()=>{renderer.frames++;return URI},pause:async()=>{renderer.status.state='paused'},resume:async()=>{renderer.status.state='ready'},setPlayback:async value=>renderer.playbacks.push(value),close:async()=>{renderer.closed++;renderer.status.state='stopped'}};live.push(renderer);return renderer;
 }});controller.run=async()=>{};await controller.start();return {controller,store,host,live,optionsSeen,set rejectLive(value){rejectLive=value}};
}
test('turning a live scene off closes its renderer immediately and static ticks do no frame work',async()=>{
 const f=await fixture(),c=f.controller;try{
  await c.select('a');const first=c.active;await c.tick();const frame=f.host.image;await c.patch({playback:{sceneLive:false}});
  assert.equal(first.closed,1);assert.equal(f.host.image,frame);assert.equal(c.playback.state,'static');assert.equal((await f.store.load()).playback.sceneLive,false);const calls=first.frames;
  for(let i=0;i<50;i++)await c.tick();assert.equal(first.frames,calls);assert.equal(c.loopDelay(),500);assert.equal(c.active.status.still,true);
  c.windowVisible=()=>false;await c.tick(1000);await c.tick(62000);assert.ok(c.active);c.windowVisible=()=>true;await c.tick();assert.equal(f.live.length,1);
  await c.patch({playback:{sceneLive:true}});assert.equal(f.live.length,2);assert.equal(c.playback.state,'playing');assert.equal(f.optionsSeen.at(-1).options.explicitRetry,true);
 }finally{await c.close()}
});
test('scene settings do not freeze videos or reuse a different scene frame; failed enable keeps the still',async()=>{
 const f=await fixture(),c=f.controller;try{await c.select('a');await c.patch({playback:{sceneLive:false}});await c.select('b');assert.equal(c.playback.state,'playing');await c.select('c');assert.equal(c.playback.state,'static');assert.equal(f.optionsSeen.at(-1).options.stillFrame,null);const still=c.active;f.rejectLive=true;await assert.rejects(c.patch({playback:{sceneLive:true}}),/live failure/);assert.equal(c.active,still);assert.equal(c.settings.playback.sceneLive,false)}finally{await c.close()}
});
test('a renderer that can no longer pause does not prevent switching to a safe still',async()=>{
 const f=await fixture();try{await f.controller.select('a');const old=f.controller.active;old.pause=async()=>{throw Error('GPU disconnected')};await f.controller.patch({playback:{sceneLive:false}});assert.equal(old.closed,1);assert.equal(f.controller.playback.state,'static')}finally{await f.controller.close()}
});
test('15/30/60 choices reach the renderer without re-preparing and are independent of quality mode',async()=>{
 const f=await fixture(),c=f.controller;try{await c.select('a');await c.patch({performance:{qualityMode:'low'}});const renderer=c.active,prepared=f.live.length;for(const fps of [15,30,60]){await c.patch({playback:{renderFps:fps,displayFps:fps}});assert.equal(c.active,renderer);assert.equal(renderer.playbacks.at(-1).renderFps,fps);assert.equal(renderer.playbacks.at(-1).displayFps,fps)}assert.equal(f.live.length,prepared);for(const qualityMode of ['fixed','balanced','low']){const output=c.renderPlayback(mergeSettings(defaults(),{performance:{qualityMode},playback:{renderFps:60,displayFps:60}}));assert.equal(output.playback.renderFps,60);assert.equal(output.playback.displayFps,60)}}finally{await c.close()}
});
