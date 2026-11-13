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
test('one verified host can show its own cached image through failed attachment attempts',{timeout:20000},async()=>{
 const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
 const {defaults}=require('../../src/wallpaper/schema.cjs'),{createSupervisor}=require('../../src/companion/supervisor.cjs');
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'cw-fallback-'));
 const cached='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=';
 const selectedId='same-wallpaper',settings=defaults();settings.wallpaper.selectedId=selectedId;
 await fs.writeFile(path.join(data,'last-wallpaper-frame.json'),JSON.stringify({selectedId,uri:cached}));
 const process={pid:1,startTime:'10',managed:true},host={id:'codex-desktop',kind:'codex-desktop',appVersion:'fixture',processes:[process]};
 let shell={...ready,frameCount:0},generation=0,open=false,transportReady=true,showCount=0,clears=0,renderCount=0,image=null;
 const store={load:async()=>structuredClone(settings)},appearance={view:async()=>({settings}),controller:{snapshot:()=>({settings}),patch:async patch=>Object.assign(settings,patch)}};
 const connect=async()=>{
  if(!transportReady)throw Object.assign(Error('No new connection'),{code:'HOST_ENDPOINT_PENDING'});
  open=true;
  return {client:{get connected(){return open},close(){open=false},async evaluate(expression){
   if(expression.includes('const applyFallbackStyles=')){
    assert.equal(shell.frameCount,1);assert.ok(expression.includes(cached));image=cached;showCount++;return true;
   }
   if(expression.includes('?.dataset.cwFallback')){clears++;image=null;return}
   return shell;
  }}};
 };
 const runner=createRuntimeRunner({paths:{data},store,library:{get:()=>null},connect,watchWindow:()=>({stableVisible:true,close(){}}),async createRuntime(options){
  renderCount++;assert.equal(options.services.startupPlaceholder.uri,cached);
  assert.equal(image,cached);image='live';
  const controller={settings,playback:{state:'playing'},active:{status:{state:'ready'}},snapshot:()=>({})};
  return {controller,refresh:async()=>({stylesConfirmed:true,imageConfirmed:true}),close:async()=>({restored:true})};
 }});
 // Manual reconnects drive the supervisor; the adapter uses its production sampling.
 const clock={now:()=>0,setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){}};
 const hosts={scan:async()=>[host],watch:()=>({close(){}}),launch:async(id,options)=>({...process,appVersion:'fixture',generation:options.generation,sessionId:String(++generation),runDirectory:data}),close(){}};
 const seen=[];const supervisor=createSupervisor({hosts,runner,appearance,clock});
 supervisor.subscribe(state=>seen.push({fallback:state.fallback?.source,error:state.error?.code,applied:state.observed.applied}));
 try{
  const starting=supervisor.start();
  while(!open)await new Promise(setImmediate);
  assert.equal(showCount,0);
  shell={...ready,editorCount:2};await starting;
  assert.equal(supervisor.snapshot().error.code,'ADAPTER_LAYOUT_MISMATCH');assert.equal(image,cached);assert.equal(showCount,1);assert.equal(renderCount,0);
  assert.ok(seen.some(s=>s.fallback==='cache'&&!s.applied&&s.error===undefined));
  transportReady=false;await supervisor.reconnect();
  assert.equal(supervisor.snapshot().error.code,'HOST_ENDPOINT_PENDING');assert.equal(supervisor.snapshot().fallback.source,'cache');assert.equal(image,cached);assert.equal(open,false);
  transportReady=true;await supervisor.setEnabled(false);
  assert.equal(image,null);assert.equal(supervisor.snapshot().fallback,null);assert.equal(clears,1);
  shell=ready;settings.enabled=true;await supervisor.reconnect();
  assert.equal(image,'live');assert.equal(supervisor.snapshot().observed.applied,true);assert.equal(supervisor.snapshot().fallback,null);assert.equal(clears,1);assert.equal(renderCount,1);
 }finally{await supervisor.close()}
});
