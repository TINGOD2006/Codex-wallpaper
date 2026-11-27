const {test}=require('node:test'),assert=require('node:assert/strict');
const {createRuntimeRunner}=require('../../src/companion/runtime-runner.cjs'),{createSupervisor}=require('../../src/companion/supervisor.cjs'),{defaults}=require('../../src/wallpaper/schema.cjs');
const {resolvePlayback}=require('../../src/renderer/viewport.cjs');
test('prewarm is limited to selected live supported scenes and preserves disabled/paused preferences',async()=>{
 let calls=0,kind='scene',capability='supported';const runner=createRuntimeRunner({library:{get:()=>({kind,capability})},rendererService:{warm(){calls++}}}),s=defaults();s.wallpaper.selectedId='a';runner.prewarm(s);assert.equal(calls,1);
 for(const patch of [{enabled:false},{wallpaper:{...s.wallpaper,enabled:false}},{playback:{...s.playback,paused:true}},{playback:{...s.playback,sceneLive:false}},{performance:{...s.performance,rendererMode:'isolated'}}])runner.prewarm({...s,...patch});
 kind='image';runner.prewarm(s);kind='scene';capability='unsupported';runner.prewarm(s);assert.equal(calls,1);
});
test('native verification and renderer warmup run together without warmup claiming application',async()=>{
 const events=[];let release;const gate=new Promise(r=>release=r),host={id:'codex-desktop',kind:'codex-desktop',appVersion:'99',processes:[{pid:1,startTime:'10',managed:true}]};
 const hosts={scan:async()=>[host],watch:()=>({close(){}}),launch:async(id,{generation})=>{events.push('launch');return {generation,pid:1,startTime:'10',sessionId:'test',appVersion:'99'}},close(){}};
 const runner={prewarm:async()=>{events.push('warm');await gate},attach:async()=>{events.push('attach');return {adapter:{regions:{}},observe:async()=>({connected:true,layoutPassed:true,stylesConfirmed:true,imageConfirmed:true,requestedImage:true,rendererHealthy:true,playback:{state:'playing'}}),close:async()=>({restored:true})}}};
 const supervisor=createSupervisor({hosts,runner,appearance:{view:async()=>({settings:defaults()})}});try{await supervisor.start();assert.ok(events.indexOf('warm')<events.indexOf('attach'));assert.equal(supervisor.snapshot().observed.applied,true)}finally{release();await supervisor.close()}
});
test('an ordinary unmanaged host never triggers renderer warmup',async()=>{
 let warmed=false;const host={id:'codex-desktop',kind:'codex-desktop',processes:[{pid:1,startTime:'10',managed:false}]},hosts={scan:async()=>[host],watch:()=>({close(){}}),close(){}};
 const supervisor=createSupervisor({hosts,runner:{prewarm(){warmed=true}},appearance:{view:async()=>({settings:defaults()})}});try{await supervisor.start();assert.equal(warmed,false);assert.equal(supervisor.snapshot().phase,'needs-launch')}finally{await supervisor.close()}
});
test('the first host watcher inventory replaces a separate cold startup scan',async()=>{
 const host={id:'codex-desktop',kind:'codex-desktop',appVersion:'99.1',processes:[{pid:1,startTime:'10',managed:true}]};
 let sample,settle,scans=0,launches=0;
 const initial=new Promise(resolve=>settle=resolve);
 const hosts={
  watch(listener,{waitForInventory}){assert.equal(waitForInventory,true);sample=listener;return {initial,close:()=>settle()}},
  async scan(){scans++;return [host]},
  async launch(id,{generation}){launches++;return {generation,pid:1,startTime:'10',sessionId:'fixture',appVersion:'99.1'}},
  close(){}
 };
 const runner={attach:async()=>({
  adapter:{},
  observe:async()=>({connected:true,layoutPassed:true,stylesConfirmed:true,requestedImage:false,rendererHealthy:true,playback:{state:'off'}}),
  close:async()=>({restored:true})
 })};
 const supervisor=createSupervisor({hosts,runner,appearance:{view:async()=>({settings:defaults()})}});
 try{
  const starting=supervisor.start();
  sample({type:'hosts',hosts:[host]});
  settle();
  await starting;
  assert.equal(scans,0);
  assert.equal(launches,1);
  assert.equal(supervisor.snapshot().observed.connected,true);
 }finally{await supervisor.close()}
});

const readyShell={documentToken:'fixture',rootViewportCount:0,activeMainSurfaceCount:1,frameCount:1,composerBodyCount:1,composerEditorCount:1,editorCount:1,mode:'codex'};
const scene={id:'scene',kind:'scene',capability:'supported'};
const session={generation:3,runDirectory:'fixture',appVersion:'99.1'};
function startupFixture({settings,prepare,createRuntime,inspect=async()=>readyShell,visible=true}){
 return createRuntimeRunner({paths:{},store:{load:async()=>structuredClone(settings)},library:{get:()=>scene},
  connect:async()=>({client:{connected:true,close(){},evaluate:inspect}}),
  watchWindow:()=>({stableVisible:visible,stableResponsive:true,close(){}}),rendererService:{prepare},createRuntime});
}
function fixedSceneSettings(){
 const settings=defaults();settings.enabled=true;settings.wallpaper.enabled=true;settings.wallpaper.selectedId=scene.id;
 settings.performance.resolutionMode='manual';settings.playback.width=1920;settings.playback.height=1080;
 return settings;
}

test('a visible fixed-size scene prepares before shell readiness and is handed to the runtime once',async()=>{
 const settings=fixedSceneSettings(),events=[];
 const lease={pause:async()=>events.push('paused'),close:async()=>events.push('closed')};
 let samples=0;
 const runner=startupFixture({settings,
  inspect:async()=>{events.push('inspect');return ++samples===1?{...readyShell,mode:null}:readyShell},
  prepare:async(entry,playback,options)=>{
   assert.equal(entry,scene);assert.deepEqual(playback,resolvePlayback(settings).playback);assert.equal(options.hostGeneration,session.generation);
   events.push('prepare');return lease;
  },
  async createRuntime({services}){
   events.push('runtime');
   assert.equal(await services.startupScene.take(scene,resolvePlayback(settings).playback,{performance:settings.performance}),lease);
   assert.equal(await services.startupScene.take(scene,resolvePlayback(settings).playback,{performance:settings.performance}),undefined);
   return {controller:{settings},close:async()=>lease.close()};
  }
 });
 const runtime=await runner.attach(session);
 await runtime.close();
 assert.deepEqual(events,['inspect','prepare','paused','inspect','inspect','runtime','closed']);
});

test('changed playback or cancellation closes the candidate without handing it to the wrong request',async()=>{
 for(const change of ['settings','request','host']){
  const settings=fixedSceneSettings(),hostAbort=new AbortController();
  let closeCount=0,prepareCount=0,inspectCount=0;
  const runner=startupFixture({settings,
   prepare:async()=>{prepareCount++;return {pause:async()=>{},close:async()=>{closeCount++}}},
   inspect:async()=>{if(++inspectCount===2&&change==='host')hostAbort.abort();return readyShell},
   async createRuntime({services}){
    assert.notEqual(change,'host');
    const requestAbort=new AbortController(),{playback}=resolvePlayback(settings);
    if(change==='settings')playback.renderFps=playback.renderFps===15?30:15;
    const take=services.startupScene.take(scene,playback,{performance:settings.performance,signal:requestAbort.signal});
    if(change==='request'){requestAbort.abort();await assert.rejects(take,{name:'AbortError'})}
    else assert.equal(await take,undefined);
    return {controller:{settings},close:async()=>({restored:true})};
   }
  });
  if(change==='host')await assert.rejects(runner.attach(session,undefined,{signal:hostAbort.signal}),{name:'AbortError'});
  else await (await runner.attach(session)).close();
  assert.equal(prepareCount,1);assert.equal(closeCount,1);
 }
});

test('scene preparation waits for the runtime with no measured viewport, a hidden window or power saving',async()=>{
 for(const reason of ['window','hidden','powerSaving']){
  const settings=fixedSceneSettings();
  if(reason==='window')settings.performance.resolutionMode='window';
  if(reason==='powerSaving')settings.performance.powerSaving=true;
  const runner=startupFixture({settings,visible:reason!=='hidden',
   prepare:async()=>assert.fail('startup must not prepare this scene'),
   async createRuntime({services}){
    assert.equal(services.startupScene,undefined);
    return {controller:{settings},close:async()=>({restored:true})};
   }
  });
  await (await runner.attach(session)).close();
 }
});

test('window-sized scene preparation reuses only a matching document and output size',async()=>{
 const viewport={cssWidth:1280,cssHeight:720,dpr:1.25,visible:true,documentToken:readyShell.documentToken};
 for(const caseName of ['same','window resized','document changed']){
  const settings=fixedSceneSettings();
  settings.performance.resolutionMode='window';
  let sample=0,prepares=0,closes=0;
  const lease={pause:async()=>{},close:async()=>{closes++}};
  const runner=startupFixture({settings,
   inspect:async expression=>{
    if(++sample===1){assert.match(expression,/sample\.viewport/);return {...readyShell,mode:null,viewport}}
    return readyShell;
   },
   prepare:async(entry,playback)=>{
    assert.equal(sample,1);
    assert.deepEqual([playback.width,playback.height],[1600,900]);
    prepares++;
    return lease;
   },
   async createRuntime({services}){
    const changed=caseName==='window resized'?{...viewport,cssWidth:900}:viewport;
    const documentToken=caseName==='document changed'?'other-shell':viewport.documentToken;
    assert.equal(await services.startupScene.take(scene,resolvePlayback(settings,changed).playback,{performance:settings.performance,documentToken}),caseName==='same'?lease:undefined);
    return {controller:{settings},close:async()=>{if(caseName==='same')await lease.close()}};
   }
  });
  await (await runner.attach(session)).close();
  assert.equal(prepares,1);
  assert.equal(closes,1);
 }
});
