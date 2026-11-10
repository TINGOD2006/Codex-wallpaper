const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {WallpaperController}=require('../../src/wallpaper/controller.cjs');
const {createStore}=require('../../src/wallpaper/store.cjs'),{defaults}=require('../../src/wallpaper/schema.cjs');
function renderer(id){return {status:{state:'ready'},closed:false,frame:async()=>id,pause:async()=>{},resume:async()=>{},setPlayback:async()=>{},async close(){this.closed=true}}}
test('idle/static work is throttled while event-driven playback stays responsive',()=>{
 const c=new WallpaperController({library:{get:id=>({kind:id})},windowVisible:()=>true});c.settings.wallpaper.selectedId='scene';c.settings.enabled=true;c.settings.wallpaper.enabled=true;c.active={eventDriven:true};
 assert.equal(c.loopDelay(),0);c.settings.playback.paused=true;assert.equal(c.loopDelay(),250);c.settings.playback.paused=false;c.windowVisible=()=>false;assert.equal(c.loopDelay(),250);
 c.windowVisible=()=>true;c.settings.wallpaper.selectedId='image';assert.equal(c.loopDelay(),500);c.settings.enabled=false;assert.equal(c.loopDelay(),250);
 c.settings.enabled=true;c.settings.wallpaper.selectedId='scene';c.active.eventDriven=false;assert.equal(c.loopDelay(1000),0);assert.ok(c.loopDelay()>0);
});
async function fixture(prepare){
  const store=createStore(await fs.mkdtemp(path.join(os.tmpdir(),'wallpaper-controller-'))),entries=new Map(['a','b','c','bad'].map(id=>[id,{id,kind:'image',capability:id==='bad'?'unsupported':'supported'}]));
  const host={image:null,colors:false,async apply(s){this.colors=s.enabled&&s.colors.enabled},async paint(uri){this.image=uri},async validateImage(){},async clearBackground(){this.image=null},async restoreAll(){this.image=null;this.colors=false}};
  const c=new WallpaperController({store,library:{get:id=>entries.get(id)},host,prepareRenderer:prepare|| (async e=>renderer(e.id)),windowVisible:()=>true});await c.start();return {c,store,host};
}
test('a late older selection cannot overwrite the newer displayed and saved wallpaper',async()=>{
  let release;const a=renderer('a'),b=renderer('b');const f=await fixture(async e=>e.id==='a'?new Promise(r=>{release=()=>r(a)}):b);
  try{const first=f.c.select('a');await new Promise(setImmediate);await f.c.select('b');release();await first;assert.equal(f.host.image,'b');assert.equal(f.c.snapshot().settings.wallpaper.selectedId,'b');assert.equal((await f.store.load()).wallpaper.selectedId,'b');assert.equal(a.closed,true)}finally{await f.c.close()}
});
test('a failed selection retains the previous wallpaper and does not save a broken reference',async()=>{
  const f=await fixture();try{await f.c.select('a');await assert.rejects(()=>f.c.select('bad'));assert.equal(f.host.image,'a');assert.equal((await f.store.load()).wallpaper.selectedId,'a')}finally{await f.c.close()}
});
test('the master switch restores native appearance without deleting chosen color preferences',async()=>{
  const f=await fixture();try{await f.c.select('a');await f.c.patch({colors:{enabled:true}});await f.c.patch({enabled:false});assert.equal(f.host.image,null);assert.equal(f.host.colors,false);assert.equal(f.c.snapshot().settings.colors.enabled,true);assert.equal(f.c.snapshot().settings.wallpaper.selectedId,'a')}finally{await f.c.close()}
});
test('rotation ignores hidden or unsupported entries and reading patches keep the active renderer',async()=>{
  let prepared=0;const f=await fixture(async e=>{prepared++;return renderer(e.id)});
  try{await f.c.select('a');await f.c.patch({reading:{scrim:.5}});assert.equal(prepared,1);await f.c.patch({library:{hidden:['b']},playback:{rotationEnabled:true,rotationSeconds:30,playlist:['a','b','bad','c']}});await f.c.tick(Date.now()+31000);assert.equal(f.host.image,'c')}finally{await f.c.close()}
});
test('save failure is visible while preserving the last persisted settings',async()=>{
  const f=await fixture();try{const save=f.store.save;f.store.save=async()=>{throw new Error('disk full')};await f.c.select('a');assert.equal(f.host.image,'a');assert.equal(f.c.snapshot().dirty,true);assert.match(f.c.snapshot().error,/disk full/);assert.equal((await f.store.load()).wallpaper.selectedId,null);f.store.save=save}finally{await f.c.close()}
});

test('a renderer released after a minute hidden is healthy suspension and resumes only when visible',async()=>{
 const {rendererIsHealthy}=require('../../src/companion/runtime-runner.cjs');let prepared=0;
 const f=await fixture(async e=>{prepared++;return renderer(e.id)});
 try{
  await f.c.select('a');f.c.windowVisible=()=>false;
  const now=Date.now();await f.c.tick(now);await f.c.tick(now+61001);
  assert.equal(f.c.active,null);assert.equal(prepared,1);
  assert.equal(rendererIsHealthy(f.c.settings,f.c.playback,null,false),true);
  await f.c.tick(now+62000);assert.equal(prepared,1);
  f.c.windowVisible=()=>true;await f.c.tick(now+63000);assert.equal(prepared,2);assert.ok(f.c.active);
 }finally{await f.c.close()}
});
