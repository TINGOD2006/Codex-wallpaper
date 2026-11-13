const {test}=require('node:test'),assert=require('node:assert/strict'),{createSupervisor}=require('../../src/companion/supervisor.cjs');
function fixture({connectEndpoint=true}={}){let now=0,ready=false,attempts=0,event;const timers=new Map();let timerId=0;const host={id:'codex-desktop',kind:'codex-desktop',appPath:'C:/Official/ChatGPT.exe',appVersion:'fixture',processes:[{pid:1,startTime:'10',managed:true}]};
 const clock={now:()=>now,setTimeout(fn,ms){timers.set(++timerId,{fn,ms});return timerId},clearTimeout(id){timers.delete(id)},setInterval:()=>1,clearInterval(){}};
 const hosts={scan:async()=>[host],watch(fn){event=fn;return {close(){}}},async launch(id,{generation}){attempts++;if(connectEndpoint&&!ready)throw Object.assign(Error('endpoint not ready'),{code:'HOST_ENDPOINT_PENDING'});return {generation,pid:host.processes[0].pid,startTime:host.processes[0].startTime,sessionId:'fixture',appVersion:'fixture'}},close(){}};
 const runner={async attach(){if(!ready)throw Object.assign(Error('shell not ready'),{code:'HOST_SHELL_PENDING',stage:'probe'});return {adapter:{},observe:async()=>({connected:true,layoutPassed:true,stylesConfirmed:true,imageConfirmed:true,requestedImage:true,rendererHealthy:true,playback:{state:'playing'}}),close:async()=>({restored:true})}}};
 const supervisor=createSupervisor({hosts,runner,clock,appearance:{view:async()=>({settings:{enabled:true}})}});
 return {supervisor,timers,host,get attempts(){return attempts},set ready(v){ready=v},set now(v){now=v},event(list){event({type:'hosts',hosts:list})},async fire(){const [id,timer]=timers.entries().next().value;timers.delete(id);now+=timer.ms;timer.fn();await supervisor.reconcile()}};
}
test('a delayed endpoint retries and succeeds without being marked incompatible',async()=>{
 const f=fixture();try{await f.supervisor.start();assert.equal(f.supervisor.snapshot().phase,'checking');assert.equal(f.supervisor.snapshot().error.code,'HOST_ENDPOINT_PENDING');assert.equal(f.attempts,1);f.ready=true;await f.fire();assert.equal(f.attempts,2);assert.equal(f.supervisor.snapshot().observed.applied,true);assert.equal(f.supervisor.snapshot().error,null)}finally{await f.supervisor.close()}
});
test('an endpoint appearing after the old twenty-second deadline still connects automatically',async()=>{
 const f=fixture();try{await f.supervisor.start();f.now=25000;f.ready=true;await f.fire();assert.equal(f.supervisor.snapshot().phase,'active');assert.equal(f.supervisor.snapshot().observed.applied,true);assert.equal(f.supervisor.snapshot().error,null)}finally{await f.supervisor.close()}
});
test('endpoint waiting is bounded and a manual retry receives a fresh budget',async()=>{
 const f=fixture();try{await f.supervisor.start();f.now=90001;await f.fire();assert.equal(f.supervisor.snapshot().phase,'error');assert.equal(f.supervisor.snapshot().error.code,'HOST_ENDPOINT_TIMEOUT');assert.equal(f.timers.size,0);const attempts=f.attempts;for(let i=0;i<3;i++)await f.supervisor.reconcile();assert.equal(f.attempts,attempts);await f.supervisor.reconnect();assert.equal(f.supervisor.snapshot().phase,'checking');f.ready=true;await f.fire();assert.equal(f.supervisor.snapshot().observed.applied,true)}finally{await f.supervisor.close()}
});
test('a new native process gets its own endpoint budget and shutdown cancels waiting',async()=>{
 const f=fixture();await f.supervisor.start();f.now=90001;f.host.processes=[{pid:2,startTime:'20',managed:true}];f.event([f.host]);await f.supervisor.reconcile();assert.equal(f.supervisor.snapshot().phase,'checking');assert.equal(f.supervisor.snapshot().error.code,'HOST_ENDPOINT_PENDING');await f.supervisor.close();assert.equal(f.timers.size,0);
});
test('discovering the endpoint repeatedly does not reset the initial shell budget',async()=>{
 const f=fixture({connectEndpoint:false});
 try{
  await f.supervisor.start();assert.equal(f.supervisor.snapshot().error.code,'HOST_SHELL_PENDING');
  f.now=89000;await f.fire();assert.equal(f.supervisor.snapshot().error.code,'HOST_SHELL_PENDING');
  await f.fire();assert.equal(f.supervisor.snapshot().error.code,'HOST_ENDPOINT_TIMEOUT');assert.equal(f.timers.size,0);
  f.ready=true;f.supervisor.attachExisting();await f.supervisor.reconcile();assert.equal(f.supervisor.snapshot().observed.applied,true);
 }finally{await f.supervisor.close()}
});
