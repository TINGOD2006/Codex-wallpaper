const {test}=require('node:test'),assert=require('node:assert/strict');
const {createRendererService}=require('../../src/renderer/service.cjs'),{defaults}=require('../../src/wallpaper/schema.cjs');
test('static scene preparation needs no browser, hashing, pool or isolated renderer',async()=>{
 const fail=()=>{throw Error('must not start GPU work')},calls=[];
 const service=createRendererService({paths:{runtime:'fixture',data:'fixture'},browser:{start:fail,snapshot:()=>({}),onLost:()=>()=>{},close:async()=>{}},origin:{start:fail,close:async()=>{}},pool:{prepare:fail,snapshot:()=>({}),close:async()=>{}},cache:{setPins:async()=>{},snapshot:()=>({}),close:async()=>{}},fingerprint:fail,prepareIsolated:fail});
 try{const lease=await service.prepare({id:'scene',kind:'scene',capability:'unsupported'},{...defaults().playback,sceneLive:false},{still:{uri:'data:image/png;base64,YQ==',source:'cache'}});await lease.promote();assert.equal(lease.status.still,true);assert.equal(lease.status.backend,'image');assert.equal(service.snapshot().healthy,true);assert.equal(service.snapshot().renderFps,0);await lease.close()}finally{await service.close()}
});
test('power-saving scenes and videos never start a renderer, warmup or poster generation',async()=>{
 const fail=()=>{throw Error('GPU work started in power-saving mode')};
 const service=createRendererService({paths:{runtime:'fixture',data:'fixture'},browser:{start:fail,snapshot:()=>({}),onLost:()=>()=>{},close:async()=>{}},origin:{start:fail,close:async()=>{}},pool:{prepare:fail,snapshot:()=>({}),close:async()=>{}},cache:{configure:async()=>{},setPins:async()=>{},snapshot:()=>({}),close:async()=>{}},fingerprint:fail,prepareIsolated:fail});
 try{await service.configure({...defaults().performance,powerSaving:true});assert.equal(await service.warm(),false);assert.equal(await service.poster({kind:'video'}),null);for(const kind of ['scene','video']){const lease=await service.prepare({id:kind,kind,capability:'unsupported'},{...defaults().playback,powerSaving:true},{still:{uri:'data:image/png;base64,YQ==',source:'cache'}});await lease.promote();assert.equal(lease.status.still,true);assert.equal(service.snapshot().renderFps,0);await lease.close()}}finally{await service.close()}
});
