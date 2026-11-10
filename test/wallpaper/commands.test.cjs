const {test}=require('node:test'),assert=require('node:assert/strict');
const {createCommandHandler,isRootContext}=require('../../src/wallpaper/commands.cjs');
const {defaults}=require('../../src/wallpaper/schema.cjs');
function fixture(){let calls=0;const settings=defaults(),controller={snapshot:()=>({settings}),async patch(){calls++;return this.snapshot()},select:async()=>{calls++}};const library={cards:()=>[],scan:async()=>{calls++},importFile:async()=>{calls++}};const handler=createCommandHandler({sessionId:'s',panelId:'p',controller,library,presets:{list:async()=>[]},chooseFile:async()=>({cancelled:true})});return {handler,calls:()=>calls,cmd:(seq,action,payload={})=>({sessionId:'s',panelId:'p',seq,action,payload})}}
test('invalid session, sequence, action and editable fields never reach the backend',async()=>{
 const f=fixture();for(const cmd of [{...f.cmd(1,'library.refresh'),sessionId:'old'},f.cmd(0,'library.refresh'),f.cmd(1,'eval'),f.cmd(1,'settings.patch',{patch:{library:{roots:['C:/x']}}}),f.cmd(1,'library.import',{path:'C:/x'})])assert.equal((await f.handler.dispatch(cmd)).ok,false);assert.equal(f.calls(),0);
});
test('replayed commands run once and a picker cancellation does not mutate data',async()=>{
 const f=fixture(),cmd=f.cmd(1,'library.refresh');const replies=await Promise.all([f.handler.dispatch(cmd),f.handler.dispatch(cmd)]);assert.ok(replies.every(r=>r.ok));assert.equal(f.calls(),1);
 assert.equal((await f.handler.dispatch(f.cmd(2,'library.import'))).cancelled,true);assert.equal(f.calls(),1);
 assert.equal((await f.handler.dispatch({...cmd,action:'library.import'})).ok,false);assert.equal((await f.handler.dispatch(f.cmd(1,'library.refresh'))).ok,true);
 f.handler.close();assert.equal((await f.handler.dispatch(f.cmd(3,'library.refresh'))).ok,false);
});
test('only the main default execution context can invoke the wallpaper binding',()=>{
 const frame={id:'root',url:'app://-/index.html',securityOrigin:'app://-'},ctx={id:1,origin:'app://-',auxData:{frameId:'root',isDefault:true}};
 assert.ok(isRootContext(ctx,frame));assert.ok(!isRootContext({...ctx,auxData:{...ctx.auxData,isDefault:false}},frame));assert.ok(!isRootContext({...ctx,auxData:{...ctx.auxData,frameId:'child'}},frame));assert.ok(!isRootContext({...ctx,origin:'https://x'},frame));
});
test('a delayed preset cannot overwrite a newer settings action or commit after handler closure',async()=>{
 for(const close of [false,true]){
  let release;let current=defaults(),applied=0;const preset=defaults();preset.reading.scrim=.25;
  const controller={snapshot:()=>({settings:current}),patch:async patch=>{current=require('../../src/wallpaper/schema.cjs').mergeSettings(current,patch)},applyPreset:async s=>{applied++;current=s}};
  const h=createCommandHandler({sessionId:'s',panelId:'p',controller,library:{cards:()=>[]},presets:{list:async()=>[],resolve:()=>new Promise(r=>release=()=>r(preset))}});
  const first=h.dispatch({sessionId:'s',panelId:'p',seq:1,action:'presets.apply',payload:{id:'builtin:reading'}});await new Promise(setImmediate);
  if(close)h.close();else await h.dispatch({sessionId:'s',panelId:'p',seq:2,action:'settings.patch',payload:{patch:{reading:{scrim:.9}}}});
  release();await first;assert.equal(applied,0);assert.equal(current.reading.scrim,close?.84:.9);
 }
});
