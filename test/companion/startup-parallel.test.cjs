const {test}=require('node:test'),assert=require('node:assert/strict');
const {createRuntimeRunner}=require('../../src/companion/runtime-runner.cjs'),{createSupervisor}=require('../../src/companion/supervisor.cjs'),{defaults}=require('../../src/wallpaper/schema.cjs');
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
