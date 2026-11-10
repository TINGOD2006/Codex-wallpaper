const {test}=require('node:test'),assert=require('node:assert/strict');
const {waitForReadyAdapter,createRuntimeRunner}=require('../../src/companion/runtime-runner.cjs');
const ready={documentToken:'1',rootViewportCount:0,activeMainSurfaceCount:1,frameCount:1,composerBodyCount:1,composerEditorCount:1,editorCount:1,mode:'codex'};
test('background compatibility probes require two full proofs from the same document and always close transport',async()=>{
 for(const snapshots of [[ready,ready],[ready,{...ready,documentToken:'other'}],[{...ready,editorCount:2}]]){
  let sample=0,closed=0;const runner=createRuntimeRunner({connect:async()=>({client:{evaluate:async()=>snapshots[sample++],close(){closed++}}})});
  const result=await runner.probe({runDirectory:'fixture',appVersion:'99.1'});assert.equal(result,snapshots.length===2&&snapshots[1].documentToken==='1');assert.equal(closed,1);
 }
 const runner=createRuntimeRunner({connect:async()=>{throw Error('Identity changed')}});assert.equal(await runner.probe({runDirectory:'fixture'}),false);
});
test('cold React shell must pass two consecutive full contracts in one document',async()=>{
 let i=0;const states=[{...ready,mode:null},ready,{...ready,documentToken:'2'},{...ready,documentToken:'2'}],waits=[];
 const result=await waitForReadyAdapter({inspect:async()=>states[i++],appVersion:'99.1',sleep:async n=>waits.push(n)});
 assert.equal(result.ok,true);assert.equal(i,4);assert.deepEqual(waits,[150,300,600]);
});
test('shell readiness does not accept unsafe editors or wait forever',async()=>{
 let samples=0;await assert.rejects(waitForReadyAdapter({inspect:async()=>{samples++;return {...ready,editorCount:2}},appVersion:'99.1',sleep:async()=>{}}),e=>e.code==='ADAPTER_LAYOUT_MISMATCH'&&e.checks.some(c=>c.id==='editors'&&!c.passed));assert.equal(samples,7);
});
test('shell readiness is cancelled before probing an abandoned connection',async()=>{
 const abort=new AbortController();abort.abort();await assert.rejects(waitForReadyAdapter({inspect:async()=>{throw new Error('must not inspect')},signal:abort.signal}),{name:'AbortError'});
});
test('a slow mode menu can become ready after the former startup deadline',async()=>{
 let samples=0;const adapter=await waitForReadyAdapter({inspect:async()=>({...ready,mode:++samples<12?null:'chatgpt'}),appVersion:'99.1',sleep:async()=>{}});
 assert.equal(adapter.ok,true);assert.equal(samples,13);
});
test('a persistently missing mode remains pending without accepting the shell',async()=>{
 let samples=0;await assert.rejects(waitForReadyAdapter({inspect:async()=>{samples++;return {...ready,mode:null}},appVersion:'99.1',sleep:async()=>{}}),e=>e.code==='HOST_SHELL_PENDING');assert.equal(samples,32);
});
