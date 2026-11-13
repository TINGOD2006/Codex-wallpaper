const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {observeRuntime,rendererIsHealthy,monitorTransport}=require('../../src/companion/runtime-runner.cjs'),{createSupervisor}=require('../../src/companion/supervisor.cjs'),{defaults}=require('../../src/wallpaper/schema.cjs');
test('hidden and restoring hosts receive no interface checks; a hide during an in-flight check does not reconnect',async()=>{
 const settings=defaults();settings.wallpaper.selectedId='A';let refreshes=0;
 const monitor={stableVisible:false},controller={settings,playback:{state:'paused'},active:{status:{state:'paused'}},snapshot:()=>({})},runtime={controller,async refresh(){refreshes++;return {stylesConfirmed:true,imageConfirmed:true}}},client={connected:true};
 for(let i=0;i<20;i++)assert.equal((await observeRuntime({client,runtime,monitor})).suspended,true);
 assert.equal(refreshes,0);monitor.stableVisible=true;assert.equal((await observeRuntime({client,runtime,monitor})).suspended,false);assert.equal(refreshes,1);
 runtime.refresh=async()=>{monitor.stableVisible=false;throw new Error('Runtime.evaluate timed out')};assert.equal((await observeRuntime({client,runtime,monitor})).suspended,true);
 monitor.stableVisible=true;runtime.refresh=async()=>{throw new Error('Real visible failure')};await assert.rejects(observeRuntime({client,runtime,monitor}),/Real visible failure/);
 client.connected=false;await assert.rejects(observeRuntime({client,runtime,monitor}),{code:'HOST_IDENTITY_CHANGED'});
});
test('a released renderer can rebuild after restore without concealing a failed lease or failed rebuild',()=>{
 const settings=defaults();settings.wallpaper.selectedId='A';
 for(const playback of [{state:'paused',suspended:true},{state:'loading',suspended:true,pendingId:'A'}])assert.equal(rendererIsHealthy(settings,playback,null,true),true);
 assert.equal(rendererIsHealthy(settings,{state:'error',suspended:true},null,true),false);
 assert.equal(rendererIsHealthy(settings,{state:'loading',suspended:true,pendingId:'A'},{invalid:'lost',status:{state:'paused'}},true),false);
});
test('output failure stops host checks even while visible and remains an explicit recoverable error',async()=>{
 let reads=0;const result=await observeRuntime({client:{connected:true},monitor:{stableVisible:true},runtime:{controller:{playback:{state:'error',error:'fixture'}},refresh:async()=>{reads++}}});
 assert.equal(reads,0);assert.equal(result.suspended,true);assert.equal(result.playback.state,'error');
});
test('a transport stall skips DOM work until a bounded probe succeeds',async()=>{
 let now=0,refreshes=0,pings=0;
 const settings=defaults(),monitor={stableVisible:true,stableResponsive:true};settings.playback.pauseWhenHidden=false;
 const client=Object.assign(new EventEmitter(),{connected:true,async evaluate(expression){assert.equal(expression,'true');pings++;return true}});
 const controller={settings,playback:{state:'playing'},snapshot:()=>({})};
 const runtime={controller,async refresh(){if(++refreshes===1){client.emit('requestTimeout','Runtime.evaluate');throw Object.assign(Error('timed out'),{code:'PROTOCOL_TIMEOUT'})}return {stylesConfirmed:true}}};
 const transport=monitorTransport(client,monitor,()=>now);
 try{
  const sample=()=>observeRuntime({client,runtime,monitor,transport});
  assert.equal((await sample()).hostUnresponsive,true);assert.equal(transport.responsive(),false);
  now=1999;await sample();assert.equal(pings,0);assert.equal(refreshes,1);
  now=10000;monitor.stableResponsive=false;await sample();assert.equal(pings,0);assert.equal(refreshes,1);
  monitor.stableResponsive=true;assert.equal((await sample()).suspended,false);
  assert.equal(pings,1);assert.equal(refreshes,2);assert.equal(transport.responsive(),true);
 }finally{transport.close();assert.equal(client.listenerCount('requestTimeout'),0)}
});
test('persistent protocol timeouts signal reconnection after bounded recovery',async()=>{
 let now=0,pings=0;
 const monitor={stableVisible:true,stableResponsive:true},client=Object.assign(new EventEmitter(),{connected:true,async evaluate(){pings++;this.emit('requestTimeout','Runtime.evaluate');throw Object.assign(Error('timed out'),{code:'PROTOCOL_TIMEOUT'})}});
 const transport=monitorTransport(client,monitor,()=>now);
 try{
  client.emit('requestTimeout','Runtime.evaluate');
  for(const time of [2000,6000,14000]){now=time;await transport.recover()}
  now=22000;monitor.stableResponsive=false;await transport.recover();assert.equal(pings,3);
  monitor.stableResponsive=true;await assert.rejects(transport.recover(),{code:'HOST_IDENTITY_CHANGED'});
 }finally{transport.close()}
});
test('minimize and restore retain one host attachment and never publish fresh application proof while suspended',async()=>{
 let suspended=false,hung=false,attachments=0,closes=0,now=1000;const host={id:'codex-desktop',kind:'codex-desktop',appVersion:'fixture',processes:[{pid:9,startTime:'90',managed:true}]};
 const proof={connected:true,layoutPassed:true,stylesConfirmed:true,imageConfirmed:true,rendererHealthy:true,requestedImage:true,playback:{state:'playing'}};
 const hosts={scan:async()=>[host],watch:()=>({close(){}}),launch:async(id,{generation})=>({generation,sessionId:'fixture',pid:9,startTime:'90',appVersion:'fixture'}),close(){}},runner={attach:async()=>{attachments++;return {adapter:{},hostResponsive:()=>!hung,observe:async()=>suspended?{suspended:true,hostUnresponsive:hung,connected:true,playback:{state:'paused'}}:proof,close:async()=>{closes++;return {restored:true}}}}};
 const supervisor=createSupervisor({hosts,runner,appearance:{view:async()=>({settings:{enabled:true}})},clock:{now:()=>now,setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){}}});
 try{
  await supervisor.start();const first=supervisor.snapshot();assert.equal(first.observed.applied,true);
  for(let i=0;i<10;i++){suspended=true;now+=1000;await supervisor.reconcile();const hidden=supervisor.snapshot();assert.equal(hidden.phase,'paused');assert.equal(hidden.observed.applied,false);assert.equal(hidden.observed.confirmedAt,first.observed.confirmedAt+(i?i*2000:0));suspended=false;now+=1000;await supervisor.reconcile();assert.equal(supervisor.snapshot().phase,'active')}
  suspended=hung=true;await supervisor.reconcile();assert.equal((await supervisor.reconnect()).error.code,'HOST_UNRESPONSIVE');assert.equal(supervisor.snapshot().observed.connected,true);
  suspended=hung=false;await supervisor.reconcile();assert.equal(supervisor.snapshot().error,null);assert.equal(supervisor.snapshot().observed.applied,true);
  assert.equal(attachments,1);assert.equal(closes,0);assert.equal(supervisor.snapshot().observed.generation,first.observed.generation);
 }finally{await supervisor.close()}
});
