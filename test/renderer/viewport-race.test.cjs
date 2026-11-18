const {test}=require('node:test'),assert=require('node:assert/strict'),{WallpaperController}=require('../../src/wallpaper/controller.cjs'),{defaults}=require('../../src/wallpaper/schema.cjs');
async function setup(){const saved=defaults();saved.wallpaper.selectedId='A';let writes=0;const sizes=[],store={load:async()=>structuredClone(saved),save:async()=>{writes++}},host={async apply(){},async paint(){return true},async validateImage(){},async clearBackground(){},async restoreAll(){}},controller=new WallpaperController({store,host,library:{get:id=>({id,kind:'scene',capability:'supported'})},prepareRenderer:async(entry,playback)=>{sizes.push([playback.width,playback.height]);return {status:{state:'ready'},frame:async()=> 'frame',async pause(){},async resume(){},async setPlayback(){},async close(){}}}});controller.run=async()=>{};await controller.start();writes=0;return {controller,sizes,get writes(){return writes},store}}
test('resize keeps preferences and dirty state unchanged while preparing only the final viewport',async()=>{const f=await setup();try{const before=JSON.stringify(f.controller.settings);f.controller.setViewport({cssWidth:1200,cssHeight:700,dpr:1,visible:true});f.controller.setViewport({cssWidth:1536,cssHeight:816,dpr:1.25,visible:true});await f.controller.whenIdle();assert.deepEqual(f.sizes.at(-1),[1920,1020]);assert.equal(f.sizes.length,2);assert.equal(JSON.stringify(f.controller.settings),before);assert.equal(f.writes,0);assert.equal(f.controller.dirty,false)}finally{await f.controller.close()}});
test('resize waits for the current user save and cannot turn it into an unsaved preview',async()=>{const f=await setup();let release,entered;const saving=new Promise(r=>{entered=r});f.store.save=async()=>{entered();await new Promise(r=>{release=r})};try{const request=f.controller.patch({reading:{scrim:.2}});await saving;f.controller.setViewport({cssWidth:1280,cssHeight:720,dpr:1.25,visible:true});await new Promise(setImmediate);release();await request;await f.controller.whenIdle();assert.equal(f.controller.settings.reading.scrim,.2);assert.equal(f.controller.dirty,false);assert.deepEqual(f.sizes.at(-1),[1600,900])}finally{release?.();await f.controller.close()}});
test('a user selection cancels an in-progress resize without losing the saved preference',async()=>{const f=await setup(),prepare=f.controller.prepareRenderer;let entered;const preparing=new Promise(r=>{entered=r});f.controller.prepareRenderer=async(entry,playback,options)=>{if(entry.id==='A'){entered();await new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}))}return prepare(entry,playback,options)};try{f.controller.setViewport({cssWidth:1280,cssHeight:720,dpr:1.25,visible:true});const resize=f.controller.flushViewport();await preparing;await f.controller.select('B');await resize;await f.controller.whenIdle();assert.equal(f.controller.settings.wallpaper.selectedId,'B');assert.equal(f.controller.dirty,false);assert.deepEqual(f.sizes.at(-1),[1600,900]);assert.equal(f.writes,1)}finally{await f.controller.close()}});
test('manual mode and hidden zero-size updates never replace the explicit renderer',async()=>{const f=await setup();try{await f.controller.patch({performance:{resolutionMode:'manual'},playback:{width:1024,height:660}});const count=f.sizes.length;f.controller.setViewport({cssWidth:1280,cssHeight:720,dpr:2,visible:true});await f.controller.whenIdle();f.controller.setViewport({cssWidth:0,cssHeight:0,dpr:2,visible:false});await f.controller.whenIdle();assert.equal(f.sizes.length,count);assert.equal(f.controller.settings.playback.width,1024);assert.equal(f.controller.settings.playback.height,660)}finally{await f.controller.close()}});

test('drag keeps the last frame and prepares only the final size after release',async()=>{
 const f=await setup(),controller=f.controller,old=controller.active;
 let pauses=0,paints=0,closes=0;
 old.pause=async()=>{pauses++;old.status.state='paused'};
 old.close=async()=>{closes++};
 controller.host.paint=async()=>{paints++;return true};
 const before=controller.paintedFrame;
 try{
  controller.setWindowMoving(true);
  controller.setViewport({cssWidth:800,cssHeight:650,dpr:1,visible:true});
  await controller.tick(1000);
  controller.setViewport({cssWidth:1100,cssHeight:760,dpr:1,visible:true});
  await controller.tick(63000);
  await controller.whenIdle();
  assert.equal(pauses,1);
  assert.equal(paints,0);
  assert.equal(closes,0);
  assert.equal(controller.paintedFrame,before);
  assert.equal(f.sizes.length,1);
  controller.setWindowMoving(false);
  await controller.whenIdle();
  assert.deepEqual(f.sizes.at(-1),[1100,760]);
  assert.equal(f.sizes.length,2);
  assert.equal(closes,1);
  assert.equal(f.writes,0);
 }finally{await controller.close()}
});

test('an in-flight resize is abandoned when a newer viewport arrives',async()=>{
 const f=await setup(),controller=f.controller,prepare=controller.prepareRenderer;
 let started;
 const preparing=new Promise(resolve=>{started=resolve});
 controller.prepareRenderer=async(entry,playback,options)=>{
  if(playback.width===960){
   started();
   await new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
  }
  return prepare(entry,playback,options);
 };
 try{
  controller.setViewport({cssWidth:960,cssHeight:640,dpr:1,visible:true});
  const resize=controller.flushViewport();
  await preparing;
  controller.setViewport({cssWidth:1200,cssHeight:720,dpr:1,visible:true});
  await resize;
  await controller.whenIdle();
  assert.deepEqual(f.sizes.at(-1),[1200,720]);
  assert.equal(controller.error,null);
 }finally{await controller.close()}
});
