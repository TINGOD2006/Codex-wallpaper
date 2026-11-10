const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createStoredController}=require('../../src/companion/stored-controller.cjs'),{createStore}=require('../../src/wallpaper/store.cjs');
const {createAppearanceService}=require('../../src/companion/appearance-service.cjs');
test('switch changes have bounded diagnostics and reconnection does not turn them on',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cw-switch-intent-')),store=createStore(root),service=await createAppearanceService({store,library:{cards:()=>[]},presets:{list:async()=>[]}});
 try{await service.controller.patch({enabled:false,wallpaper:{enabled:false}});await service.controller.patch({reading:{scrim:.42}});const events=JSON.parse(await fs.readFile(path.join(root,'switch-history.json'),'utf8'));assert.equal(events.length,1);assert.equal(events[0].source,'patch');assert.deepEqual(events[0].next,{enabled:false,wallpaperEnabled:false});const active=await createStoredController(store);await service.attach(active,1);await service.detach(1);assert.equal((await store.load()).enabled,false);assert.equal((await store.load()).wallpaper.enabled,false);await active.close()}finally{await service.close()}
});
test('attach reuses an initialized controller but still applies settings changed while offline',async()=>{
 const store=createStore(await fs.mkdtemp(path.join(os.tmpdir(),'cw-attach-reuse-'))),controller=await createStoredController(store);
 const service=await createAppearanceService({store,library:{cards:()=>[]},presets:{list:async()=>[]},chooseFile:async()=>({cancelled:true})});let requests=0;const original=controller.request;controller.request=async(...args)=>{requests++;return original(...args)};
 try{await service.attach(controller,1);assert.equal(requests,0);await service.detach(1);await service.controller.patch({reading:{scrim:.25}});await service.attach(controller,2);assert.equal(requests,1);assert.equal(controller.snapshot().settings.reading.scrim,.25)}finally{await service.close();await controller.close()}
});
test('offline settings save without rendering and preview is not persisted until flush',async()=>{
 const store=createStore(await fs.mkdtemp(path.join(os.tmpdir(),'cw-offline-'))),controller=await createStoredController(store);
 await controller.patch({enabled:false,reading:{offsetX:-64}});assert.equal((await store.load()).enabled,false);assert.equal(controller.snapshot().playback.state,'off');
 await controller.patch({reading:{offsetX:-80}},{persist:false});assert.equal((await store.load()).reading.offsetX,-64);assert.equal(controller.snapshot().dirty,true);
 await controller.patch({});assert.equal((await store.load()).reading.offsetX,-80);assert.equal(controller.snapshot().dirty,false);
 await assert.rejects(controller.patch({reading:{offsetX:'invalid'}}));assert.equal((await store.load()).reading.offsetX,-80);
});
test('disconnect waits for a setting write and old generations cannot replace the active controller',async()=>{
 const store=createStore(await fs.mkdtemp(path.join(os.tmpdir(),'cw-handoff-'))),active=await createStoredController(store);
 const service=await createAppearanceService({store,library:{cards:()=>[]},presets:{list:async()=>[]},chooseFile:async()=>({cancelled:true})});
 await service.attach(active,2);let release;const blocked=new Promise(resolve=>release=resolve),patch=active.patch;
 active.patch=async(...args)=>{await blocked;return patch(...args)};
 const writing=service.dispatch({sessionId:'m',panelId:'p',seq:1,action:'settings.patch',payload:{patch:{reading:{offsetX:-90}}}});
 await new Promise(setImmediate);const detaching=service.detach(2);release();assert.equal((await writing).ok,true);await detaching;
 assert.equal((await service.view()).settings.reading.offsetX,-90);assert.equal(await service.detach(1),false);
 assert.equal(await service.attach(active,1),false);await service.close();
});
