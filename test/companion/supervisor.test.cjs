const {test}=require('node:test'),assert=require('node:assert/strict');
const {createSupervisor}=require('../../src/companion/supervisor.cjs');
test('a blocked layout is periodically re-probed and recovery never changes manual switches',async()=>{
 for(const enabled of [true,false]){
  let now=0,ready=false,attachments=0,probes=0,writes=0;
  const settings={enabled,wallpaper:{enabled:false}},host={id:'codex-desktop',kind:'codex-desktop',processes:[{pid:9,startTime:'9',managed:true}]};
  const hosts={scan:async()=>[host],watch:()=>({close(){}}),launch:async(id,{generation})=>({generation,pid:9,startTime:'9',sessionId:'s'}),close(){}};
  const runner={probe:async()=>{probes++;return ready},attach:async()=>{attachments++;if(!ready)throw Object.assign(new Error('transition'),{code:'ADAPTER_LAYOUT_MISMATCH'});return {adapter:{},observe:async()=>({connected:true,layoutPassed:true,stylesConfirmed:true,rendererHealthy:true}),close:async()=>({restored:true})}}};
  const clock={now:()=>now,setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){}};
  const supervisor=createSupervisor({hosts,runner,appearance:{view:async()=>({settings}),controller:{patch:async()=>writes++}},clock});
  try{await supervisor.start();await supervisor.reconcile();assert.equal(probes,0);now=10001;await supervisor.reconcile();assert.equal(probes,1);assert.equal(attachments,1);ready=true;now=20002;await supervisor.reconcile();assert.equal(attachments,2);assert.equal(supervisor.snapshot().phase,enabled?'active':'disabled');assert.equal(settings.enabled,enabled);assert.equal(settings.wallpaper.enabled,false);assert.equal(writes,0)}finally{await supervisor.close()}
 }
});
test('explicit enable wallpaper changes both switches in one request',async()=>{
 let patch;const supervisor=createSupervisor({hosts:{close(){}},runner:{},appearance:{controller:{patch:async p=>{patch=p}},view:async()=>({settings:{enabled:true}})}});
 try{await supervisor.enableWallpaper();assert.deepEqual(patch,{enabled:true,wallpaper:{enabled:true}})}finally{await supervisor.close()}
});
test('a late successful background probe cannot relaunch after shutdown',async()=>{
 let now=0,release,launches=0;const pending=new Promise(r=>release=r),host={id:'codex-desktop',kind:'codex-desktop',processes:[{pid:9,startTime:'9',managed:true}]};
 const hosts={scan:async()=>[host],watch:()=>({close(){}}),launch:async(id,{generation})=>{launches++;return {generation,pid:9,startTime:'9',sessionId:'s'}},close(){}};
 const runner={attach:async()=>{throw Object.assign(new Error(),{code:'ADAPTER_LAYOUT_MISMATCH'})},probe:()=>pending};
 const supervisor=createSupervisor({hosts,runner,appearance:{view:async()=>({settings:{enabled:true}})},clock:{now:()=>now,setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){}}});
 await supervisor.start();now=10001;const checking=supervisor.reconcile();await new Promise(setImmediate);const closing=supervisor.close();release(true);await Promise.all([checking,closing]);assert.equal(launches,1);assert.equal(supervisor.snapshot().phase,'offline');
});
test('temporary mode-menu loss revokes proof and recovers without discarding the renderer',async()=>{
 let missing=false,attaches=0,closes=0,retry;const host={id:'codex-desktop',kind:'codex-desktop',appVersion:'99.1',processes:[{pid:1,startTime:'1',managed:true}]};
 const hosts={scan:async()=>[host],watch:()=>({close(){}}),launch:async(id,{generation})=>({generation,pid:1,startTime:'1',sessionId:'s'}),close(){}};
 const runner={attach:async()=>{attaches++;return {adapter:{},observe:async()=>{if(missing)throw Object.assign(new Error(),{code:'HOST_SHELL_PENDING'});return {connected:true,layoutPassed:true,stylesConfirmed:true,rendererHealthy:true}},close:async()=>{closes++;return {restored:true}}}}};
 const clock={now:Date.now,setInterval:()=>1,clearInterval(){},setTimeout:fn=>{retry=fn;return 1},clearTimeout(){}};
 const supervisor=createSupervisor({hosts,runner,appearance:{view:async()=>({settings:{enabled:true}})},clock});
 try{await supervisor.start();missing=true;await supervisor.reconcile();assert.equal(supervisor.snapshot().phase,'checking');assert.equal(supervisor.snapshot().observed.applied,false);assert.equal(closes,0);missing=false;retry();await supervisor.reconcile();assert.equal(supervisor.snapshot().phase,'active');assert.equal(attaches,1);assert.equal(closes,0)}finally{await supervisor.close()}
});
test('integrated repeated launch activates the verified session without creating another renderer',async()=>{
 let launches=0,activations=0,attachments=0,scans=0;
 const host={id:'codex-desktop',kind:'codex-desktop',appVersion:'99.1',processes:[{pid:7,startTime:'70',managed:true}]};
 const hosts={scan:async()=>{scans++;return [host]},watch:()=>({close(){}}),launch:async(id,{generation})=>{launches++;return {hostId:id,generation,sessionId:'s',pid:7,startTime:'70',appVersion:'99.1'}},activate:async session=>{assert.equal(session.pid,7);assert.equal(session.startTime,'70');activations++},close(){}};
 const runner={attach:async()=>{attachments++;return {adapter:{regions:{}},observe:async()=>({connected:true,layoutPassed:true,stylesConfirmed:true,rendererHealthy:true}),close:async()=>({restored:true})}}};
 const supervisor=createSupervisor({paths:{},hosts,runner,mode:'integrated',appearance:{view:async()=>({settings:{enabled:true}})}});
 try{await supervisor.start();const before=scans,generation=supervisor.snapshot().observed.generation;await supervisor.launch();assert.equal(scans,before);assert.equal(supervisor.snapshot().observed.generation,generation);assert.equal(supervisor.snapshot().mode,'integrated');assert.equal(launches,1);assert.equal(attachments,1);assert.equal(activations,1)}finally{await supervisor.close()}
});
test('a handoff request arriving after connection cannot arm a later unsolicited host reopen',async()=>{
 let event,launches=0;const host={id:'codex-desktop',kind:'codex-desktop',appVersion:'99.1',processes:[{pid:7,startTime:'70',managed:true}]};
 const hosts={scan:async()=>[host],watch:fn=>{event=fn;return {close(){}}},launch:async(id,{generation})=>{launches++;return {hostId:id,generation,sessionId:'connected',pid:7,startTime:'70',appVersion:'99.1'}},close(){}};
 const runner={attach:async()=>({adapter:{regions:{}},observe:async()=>({connected:true,layoutPassed:true,stylesConfirmed:true,imageConfirmed:true,requestedImage:true,rendererHealthy:true,playback:{state:'playing'}}),close:async()=>({restored:true})})};
 const supervisor=createSupervisor({paths:{},hosts,appearance:{view:async()=>({settings:{enabled:true}})},runner});
 try{await supervisor.start();assert.equal(supervisor.snapshot().phase,'active');await supervisor.waitForExitAndLaunch();assert.equal(supervisor.snapshot().pendingLaunch,false);event({type:'hosts',hosts:[{...host,processes:[]}]});await supervisor.reconcile();assert.equal(launches,1);assert.equal(supervisor.snapshot().phase,'idle')}finally{await supervisor.close()}
});
test('ordinary entry reports needs-launch and host exit does not create a restart loop',async()=>{
 let launchCount=0,event;const host={id:'codex-desktop',kind:'codex-desktop',appVersion:'99.1',processes:[{pid:1,startTime:'10',managed:false}]};
 const hosts={scan:async()=>[host],watch:fn=>{event=fn;return {close(){}}},launch:async()=>{launchCount++},close(){}};
 const appearance={view:async()=>({settings:{enabled:true}}),controller:{patch:async()=>{}}};
 const supervisor=createSupervisor({paths:{},hosts,appearance,runner:{}});await supervisor.start();
 assert.equal(supervisor.snapshot().phase,'needs-launch');assert.equal(supervisor.snapshot().observed.applied,false);
 event({type:'hosts',hosts:[{...host,processes:[]}]});await supervisor.reconcile();assert.equal(launchCount,0);assert.equal(supervisor.snapshot().phase,'idle');await supervisor.close();
});
test('an older attachment completing after an update cannot publish the old host as active',async()=>{
 let event,release,oldClosed=0,attachCount=0;
 let host={id:'codex-desktop',kind:'codex-desktop',appPath:'C:/Official/v1/ChatGPT.exe',appVersion:'1',processes:[{pid:52,startTime:'10',managed:true}]};
 const blocked=new Promise(resolve=>release=resolve),hosts={scan:async()=>[host],watch:fn=>{event=fn;return {close(){}}},launch:async(id,{generation})=>({hostId:id,generation,sessionId:host.appVersion,pid:52,startTime:host.processes[0].startTime,appVersion:host.appVersion}),close(){}};
 const runner={attach:async()=>{const old=++attachCount===1;if(old)await blocked;return {adapter:{adapterId:'test',regions:{}},observe:async()=>({connected:true,layoutPassed:true,stylesConfirmed:true,imageConfirmed:true,requestedImage:true,rendererHealthy:true,playback:{state:'playing'}}),close:async()=>{if(old)oldClosed++}}}};
 const supervisor=createSupervisor({paths:{},hosts,appearance:{view:async()=>({settings:{enabled:true}})},runner});
 const starting=supervisor.start();await new Promise(setImmediate);
 host={...host,appPath:'C:/Official/v2/ChatGPT.exe',appVersion:'2',processes:[{pid:52,startTime:'20',managed:true}]};event({type:'hosts',hosts:[host]});release();await starting;await supervisor.reconcile();
 assert.equal(oldClosed,1);assert.equal(supervisor.snapshot().observed.appVersion,'2');assert.equal(supervisor.snapshot().phase,'active');await supervisor.close();
});
test('a replacement at the same version cancels pending discovery before attaching to the retired PID',async()=>{
 let event,release,entered,oldSignal;const attached=[];
 const old={id:'codex-desktop',kind:'codex-desktop',appPath:'C:/Official/ChatGPT.exe',appVersion:'1',processes:[{pid:52,startTime:'10',managed:true}]};
 const next={...old,processes:[{pid:53,startTime:'20',managed:true}]};
 const waiting=new Promise(r=>{entered=r}),gate=new Promise(r=>{release=r});let calls=0;
 const hosts={scan:async()=>[old],watch:fn=>{event=fn;return {close(){}}},async launch(id,{generation,signal}){
  const snapshot=++calls===1?old:next;
  if(snapshot===old){oldSignal=signal;entered();await gate}
  return {...snapshot.processes[0],appVersion:snapshot.appVersion,generation,sessionId:String(calls)};
 },close(){}};
 const runner={async attach(session){attached.push(session.pid);return {observe:async()=>({connected:true,layoutPassed:true,stylesConfirmed:true,rendererHealthy:true}),close:async()=>({restored:true})}}};
 const supervisor=createSupervisor({hosts,runner,appearance:{view:async()=>({settings:{enabled:true}})}});
 const started=supervisor.start();
 try{
  await waiting;event({type:'hosts',hosts:[next]});assert.equal(oldSignal.aborted,true);release();await started;
  assert.deepEqual(attached,[53]);assert.equal(supervisor.snapshot().observed.applied,true);assert.equal(supervisor.snapshot().error,null);
 }finally{release();await started;await supervisor.close()}
});
test('passive attach wakes discovery after an initial scan failure and skips activation',async()=>{
 const host={id:'codex-desktop',kind:'codex-desktop',processes:[{pid:15,startTime:'30',managed:true}]};
 let event,opens=0,attaches=0,activations=0;
 const hosts={scan:async()=>{throw Error('Temporary discovery failure')},watch:fn=>{event=fn;return {close(){}}},async launch(id,{generation}){opens++;return {...host.processes[0],generation,sessionId:'fixture'}},async activate(){activations++},close(){}};
 const runner={async attach(){attaches++;return {observe:async()=>({connected:true,layoutPassed:true,stylesConfirmed:true,rendererHealthy:true}),close:async()=>({restored:true})}}};
 const supervisor=createSupervisor({hosts,runner,appearance:{view:async()=>({settings:{enabled:true}})}});
 try{
  await supervisor.start();assert.equal(supervisor.snapshot().error.code,'HOST_NOT_FOUND');
  supervisor.attachExisting();assert.equal(opens,0);
  event({type:'hosts',hosts:[host]});supervisor.attachExisting();await supervisor.reconcile();supervisor.attachExisting();
  assert.equal(opens,1);assert.equal(attaches,1);assert.equal(activations,0);assert.equal(supervisor.snapshot().observed.applied,true);
 }finally{await supervisor.close()}
});
test('an unavailable transport remains visible across watcher pulses until explicitly retried',async()=>{
 let event,launches=0;
 const host={id:'codex-desktop',kind:'codex-desktop',appPath:'C:/Official/current/ChatGPT.exe',appVersion:'99.2',processes:[{pid:51,startTime:'10',managed:true}]};
 const hosts={scan:async()=>[host],watch:fn=>{event=fn;return {close(){}}},launch:async()=>{launches++;throw Object.assign(new Error('No endpoint'),{code:'HOST_TRANSPORT_UNAVAILABLE'})},close(){}};
 const supervisor=createSupervisor({paths:{},hosts,appearance:{view:async()=>({settings:{enabled:true}})},runner:{}});
 try{await supervisor.start();for(let i=0;i<4;i++){event({type:'hosts',hosts:[host]});await supervisor.reconcile()}
  assert.equal(launches,1);assert.equal(supervisor.snapshot().phase,'incompatible');assert.equal(supervisor.snapshot().error.code,'HOST_TRANSPORT_UNAVAILABLE');assert.equal(supervisor.snapshot().pendingLaunch,false);
  await supervisor.reconnect();assert.equal(launches,2);
 }finally{await supervisor.close()}
});
test('renderer loss revokes applied immediately and an older observation cannot reactivate it',async()=>{
 let health,release,entered,observing,calls=0,closes=0;const waiting=new Promise(r=>{entered=r}),proof={connected:true,layoutPassed:true,stylesConfirmed:true,imageConfirmed:true,requestedImage:true,rendererHealthy:true,playback:{state:'playing'}},host={id:'codex-desktop',kind:'codex-desktop',appVersion:'99.1',processes:[{pid:7,startTime:'70',managed:true}]};
 const clock={now:Date.now,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){}},hosts={scan:async()=>[host],watch:()=>({close(){}}),launch:async(id,{generation})=>({generation,sessionId:'s',pid:7,startTime:'70',appVersion:'99.1'}),close(){}},runner={attach:async()=>({adapter:{regions:{}},subscribeHealth(fn){health=fn;return()=>{}},async observe(){if(++calls===1)return proof;entered();return new Promise(r=>{release=r})},async close(){closes++;return {restored:true}}})},supervisor=createSupervisor({paths:{},hosts,runner,clock,appearance:{view:async()=>({settings:{enabled:true}})}});
 try{await supervisor.start();assert.equal(supervisor.snapshot().observed.applied,true);observing=supervisor.reconcile();await waiting;assert.equal(typeof health,'function');health({healthy:false,expected:false,code:'POOL_LOST',retryManaged:true});assert.equal(supervisor.snapshot().observed.applied,false);release(proof);await observing;assert.equal(supervisor.snapshot().observed.applied,false);assert.equal(closes,1);assert.equal(supervisor.snapshot().error.code,'RENDERER_FAILED')}finally{release?.(proof);await observing?.catch(()=>{});await supervisor.close()}
});
