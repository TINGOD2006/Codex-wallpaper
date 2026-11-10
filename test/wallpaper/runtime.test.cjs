const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createWallpaperRuntime}=require('../../src/wallpaper/runtime.cjs'),{createStore}=require('../../src/wallpaper/store.cjs'),{defaults}=require('../../src/wallpaper/schema.cjs');
const shell={rootViewportCount:0,editorCount:1,activeMainSurfaceCount:1,frameCount:1,composerBodyCount:1,mode:'codex'};
test('steady refresh uses one synchronized shell sample and does not repeat DOM inspection or style application',async()=>{
 const dataRoot=await fs.mkdtemp(path.join(os.tmpdir(),'wallpaper-sync-'));let inspections=0,proofs=0,syncs=0;
 class Host{
  async inspect(){inspections++;return shell}async apply(){}async restoreAll(){}async clearBackground(){}
  async confirmApplied(){proofs++;return {stylesConfirmed:true,imageConfirmed:false}}
  async synchronize(settings){syncs++;return {structure:{...shell,mode:'chatgpt'},viewport:null,metrics:null,imageMissing:true,proof:{stylesConfirmed:true,imageConfirmed:false}}}
 }
 const runtime=await createWallpaperRuntime({client:{evaluate:async()=>true},identity:{sessionId:'sync',appVersion:'26.1027.6604.0'},projectRoot:path.resolve('.'),dataRoot,roots:[],Host,mountPanel:false});
 try{
  const before={inspections,proofs};for(let i=0;i<5;i++)assert.equal((await runtime.refresh()).stylesConfirmed,true);
  assert.equal(syncs,5);assert.deepEqual({inspections,proofs},before);assert.equal(runtime.status().layout,'chatgpt');
 }finally{await runtime.close()}
});
test('an external companion entry connects the renderer without adding a second host panel',async()=>{
 const projectRoot=await fs.mkdtemp(path.join(os.tmpdir(),'wallpaper-external-entry-')),dataRoot=path.join(projectRoot,'data'),store=createStore(dataRoot),saved=defaults();saved.enabled=false;await store.save(saved);
 let proofs=0;class Host{async inspect(){return shell}async apply(){}async restoreAll(){}async clearBackground(){}async confirmApplied(){proofs++;return {stylesConfirmed:true,imageConfirmed:false}}}
 class ForbiddenPanel{constructor(){throw new Error('A second host panel must not be constructed')}}
 const runtime=await createWallpaperRuntime({client:{evaluate:async()=>true},identity:{sessionId:'external',appVersion:'26.1027.3384.0'},projectRoot,dataRoot,roots:[],Host,Panel:ForbiddenPanel,mountPanel:false});
 try{const before=proofs;assert.deepEqual(await runtime.refresh(),{stylesConfirmed:true,imageConfirmed:false});assert.equal(proofs,before+1);assert.equal(runtime.panel,null);assert.equal(runtime.status().panelReady,false);assert.equal(runtime.status().uiTogglePresent,false)}finally{await runtime.close()}
});
test('startup preserves a disabled preference, Apply/Disable are compatible and panel readiness is real',async()=>{
 const dataRoot=await fs.mkdtemp(path.join(os.tmpdir(),'wallpaper-runtime-')),store=createStore(dataRoot),s=defaults();s.enabled=false;await store.save(s);let removed=false;
 class Host{async inspect(){assert.ok(removed);return shell}async apply(){}async restoreAll(){}async clearBackground(){}}
 class Panel{constructor(){this.panelId='test'}async mount(){this.ready=true}async update(){return true}async unmount(){this.ready=false}}
 const options={client:{evaluate:async()=>{removed=true}},identity:{sessionId:'test',appVersion:'26.1023.6123.0'},projectRoot:path.resolve('.'),dataRoot,roots:[],Host,Panel};
 const runtime=await createWallpaperRuntime(options);try{assert.equal(runtime.status().enabled,false);assert.equal(runtime.status().panelReady,true);await runtime.action('apply');assert.equal(runtime.status().enabled,true);await runtime.action('disable');assert.equal(runtime.status().state,'disabled');assert.equal((await store.load()).enabled,false)}finally{await runtime.close()}
 class BadPanel extends Panel{async mount(){throw new Error('mount failed')}}
 await assert.rejects(()=>createWallpaperRuntime({...options,Panel:BadPanel}),/mount failed/);
});
test('missing legacy sources keep disabled recovery UI available and retain an unresolved reference',async()=>{
 for(const kind of ['scene','image']){
  const projectRoot=await fs.mkdtemp(path.join(os.tmpdir(),'wallpaper-missing-')),dataRoot=path.join(projectRoot,'.state/wallpaper');await fs.mkdir(path.join(projectRoot,'.state'),{recursive:true});await fs.writeFile(path.join(projectRoot,'.state/status.json'),JSON.stringify({enabled:false,sceneSelected:kind==='scene'}));
  if(kind==='scene')await fs.writeFile(path.join(projectRoot,'scene.json'),JSON.stringify({enabled:true,wallpaperDirectory:path.join(projectRoot,'deleted-scene')}));else await fs.writeFile(path.join(projectRoot,'config.json'),JSON.stringify({backgroundPath:'deleted.png',overlayOpacity:.84,positionX:50}));
  class Host{async inspect(){return shell}async apply(){}async restoreAll(){}async clearBackground(){}}
  class Panel{constructor(){this.panelId='test'}async mount(){this.ready=true}async update(){return true}async unmount(){}}
  const r=await createWallpaperRuntime({client:{evaluate:async()=>true},identity:{sessionId:'s',appVersion:'26.1023.6123.0'},projectRoot,dataRoot,roots:[],Host,Panel});try{assert.equal(r.status().panelReady,true);assert.equal(r.status().enabled,false);assert.match(r.controller.settings.wallpaper.selectedId,/^missing:/);assert.ok(await fs.stat(path.join(dataRoot,'migration/selection-error.json')))}finally{await r.close()}
 }
});
test('a migrated custom scene root remains resolvable in a fresh library',async()=>{
 const projectRoot=await fs.mkdtemp(path.join(os.tmpdir(),'wallpaper-custom-migrate-')),dataRoot=path.join(projectRoot,'.state/wallpaper'),directory=path.join(projectRoot,'custom-scene');await fs.mkdir(directory);await fs.writeFile(path.join(directory,'project.json'),JSON.stringify({type:'scene',title:'Custom Scene'}));await fs.writeFile(path.join(directory,'scene.pkg'),'fixture');await fs.mkdir(path.join(projectRoot,'.state'),{recursive:true});await fs.writeFile(path.join(projectRoot,'.state/status.json'),JSON.stringify({enabled:false,sceneSelected:true}));await fs.writeFile(path.join(projectRoot,'scene.json'),JSON.stringify({enabled:true,wallpaperDirectory:directory}));
 class Host{async inspect(){return shell}async restoreAll(){}async clearBackground(){}}
 class Panel{constructor(){this.panelId='test'}async mount(){this.ready=true}async update(){return true}async unmount(){}}
 const r=await createWallpaperRuntime({client:{evaluate:async()=>true},identity:{sessionId:'s',appVersion:'26.1023.6123.0'},projectRoot,dataRoot,roots:[],Host,Panel});await r.close();const saved=await createStore(dataRoot).load(),l=require('../../src/wallpaper/library.cjs').createLibrary({roots:saved.library.roots,dataRoot});await l.scan();assert.ok(l.get(saved.wallpaper.selectedId));await l.close?.();
});
