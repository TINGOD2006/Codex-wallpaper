const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createCaptionWorker}=require('../../src/companion/caption-worker.cjs');
const flush=()=>new Promise(setImmediate);
function fixture(){
 let now=0,expected=false;const children=[],updates=[],reports=[],timers=new Map(),intervals=new Map();let id=0;
 const clock={now:()=>now,setTimeout:(fn,delay)=>{timers.set(++id,{fn,delay});return id},clearTimeout:key=>timers.delete(key),setInterval:fn=>{intervals.set(++id,fn);return id},clearInterval:key=>intervals.delete(key)};
 const worker=createCaptionWorker({executable:'owned',args:[],update:value=>updates.push(value),report:value=>reports.push(value),clock,isExpectedStop:async()=>expected,spawnProcess:()=>{
  const child=new EventEmitter();Object.assign(child,{pid:children.length+1,exitCode:null,signalCode:null,kills:0,stdout:Object.assign(new EventEmitter(),{setEncoding(){}}),kill(){this.kills++},exit(){this.exitCode=1;this.emit('exit',1)}});children.push(child);return child;
 }});
 return {worker,children,updates,reports,timers,intervals,set expected(value){expected=value},set now(value){now=value},async retry(){const [key,timer]=timers.entries().next().value;timers.delete(key);now+=timer.delay;timer.fn();await flush()},watch(){for(const fn of [...intervals.values()])fn()}};
}
test('caption exit restarts one helper and ignores output from the retired process',async()=>{
 const f=fixture();f.worker.start();const first=f.children[0];first.stdout.emit('data','{"state":"ready"}\n');first.exit();await flush();assert.equal(f.timers.size,1);await f.retry();assert.equal(f.children.length,2);const before=f.updates.length;first.stdout.emit('data','{"state":"error"}\n');assert.equal(f.updates.length,before);f.worker.stop();
});
test('caption heartbeat timeouts wait for actual exit before spawning a replacement',async()=>{
 const f=fixture();f.worker.start();const first=f.children[0];f.now=31000;f.watch();assert.equal(first.kills,0);first.stdout.emit('data','{"state":"ready"}\n');f.now=62001;f.watch();assert.equal(first.kills,1);assert.equal(f.children.length,1);assert.equal(f.timers.size,0);first.exit();await flush();await f.retry();assert.equal(f.children.length,2);f.worker.stop();
});
test('repeated caption failures have a strict retry limit and require explicit retry',async()=>{
 const f=fixture();f.worker.start();for(let i=0;i<3;i++){f.children.at(-1).exit();await flush();await f.retry()}f.children.at(-1).exit();await flush();assert.equal(f.children.length,4);assert.equal(f.timers.size,0);assert.equal(f.worker.snapshot().recovery.blocked,true);assert.ok(f.reports.some(e=>e.code==='CAPTION_RETRY_LIMIT'));await f.worker.retry();assert.equal(f.children.length,5);f.worker.stop();
});
test('expected stops, shutdown during recovery and old late exits never restart the caption',async()=>{
 const f=fixture();f.worker.start();f.expected=true;f.children[0].exit();await flush();assert.equal(f.timers.size,0);assert.equal(f.updates.at(-1).state,'off');await f.worker.retry();assert.equal(f.children.length,1);f.worker.stop();
 const g=fixture();g.worker.start();g.children[0].exit();await flush();assert.equal(g.timers.size,1);g.worker.stop();assert.equal(g.timers.size,0);g.children[0].emit('exit');await flush();assert.equal(g.children.length,1);assert.equal(g.intervals.size,0);
});
test('invalid heartbeat data cannot postpone recovery',async()=>{
 const f=fixture();f.worker.start();f.now=61000;f.children[0].stdout.emit('data','{"state":"invented"}\n');f.watch();assert.equal(f.children[0].kills,1);f.worker.stop();
});
test('a spawn exception schedules a bounded recovery and shutdown cancels it',async()=>{
 let timer,cleared=false;const states=[];
 const worker=createCaptionWorker({executable:'missing',args:[],update:v=>states.push(v),spawnProcess:()=>{throw Error('missing')},clock:{now:()=>0,setTimeout:fn=>{timer=fn;return 1},clearTimeout(){cleared=true},setInterval(){throw Error('must not watch a missing child')},clearInterval(){}}});
 worker.start();await flush();assert.ok(timer);assert.equal(states.at(-1).state,'error');worker.stop();assert.equal(cleared,true);timer();assert.equal(worker.child,null);
});
test('shutdown during the expected-stop check cannot resurrect the helper',async()=>{
 let release;const gate=new Promise(r=>release=r),child=Object.assign(new EventEmitter(),{pid:1,exitCode:null,signalCode:null,stdout:Object.assign(new EventEmitter(),{setEncoding(){}})});let spawned=0;
 const worker=createCaptionWorker({executable:'owned',args:[],update(){},isExpectedStop:()=>gate,spawnProcess:()=>{spawned++;return child},clock:{now:()=>0,setTimeout(){throw Error('must not schedule after shutdown')},clearTimeout(){},setInterval:()=>1,clearInterval(){}}});
 worker.start();child.exitCode=1;child.emit('exit');worker.stop();release(false);await flush();assert.equal(spawned,1);
});
