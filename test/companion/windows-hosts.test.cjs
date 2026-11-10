const {test}=require('node:test'),assert=require('node:assert/strict');
const {createWindowsHosts}=require('../../src/companion/windows-hosts.cjs');
test('watch restarts after exit, ignores duplicate/stale samples and cancels recovery on close',()=>{
 const {EventEmitter}=require('node:events'),children=[],timers=new Map(),events=[];let sequence=0;
 const hosts=createWindowsHosts({paths:{},clock:{setTimeout(fn,ms){const id=++sequence;timers.set(id,{fn,ms});return id},clearTimeout(id){timers.delete(id)}},spawnProcess(){const child=new EventEmitter();child.stdout=new EventEmitter();child.stdout.setEncoding=()=>{};child.kill=()=>child.emit('exit',0);children.push(child);return child}});
 const watcher=hosts.watch(e=>events.push(e)),sample='{"type":"hosts","hosts":[{"id":"codex-desktop"}]}\n';
 children[0].stdout.emit('data',sample);children[0].stdout.emit('data',sample);assert.equal(events.filter(e=>e.type==='hosts').length,1);
 children[0].emit('exit',1);assert.equal(timers.size,1);assert.equal([...timers.values()][0].ms,250);
 const timer=[...timers.values()][0];timers.clear();timer.fn();assert.equal(children.length,2);
 children[0].stdout.emit('data',sample);assert.equal(events.filter(e=>e.type==='hosts').length,1);
 children[1].stdout.emit('data',sample);assert.equal(events.filter(e=>e.type==='hosts').length,2);
 children[1].emit('error',new Error('watch lost'));children[1].emit('exit',1);assert.equal(timers.size,1);
 watcher.close();assert.equal(timers.size,0);hosts.close();
});
test('discovery keeps current package metadata and launch errors retain visible codes',async()=>{
 const hosts=createWindowsHosts({paths:{runtime:'C:/fixture/runtime'},exec:async(file,args)=>{
  if(args.includes('-HostId'))return {stdout:JSON.stringify({ok:false,error:{code:'HOST_NEEDS_MANAGED_LAUNCH',message:'normal launch'}})};
  return {stdout:JSON.stringify([{id:'codex-desktop',kind:'codex-desktop',appVersion:'99.1.2.3',appPath:'C:/Official/v2/ChatGPT.exe',installed:true,processes:[]}])};
 }});
 assert.equal((await hosts.scan())[0].appVersion,'99.1.2.3');
 await assert.rejects(hosts.launch('codex-desktop',{generation:1}),{code:'HOST_NEEDS_MANAGED_LAUNCH'});
 await assert.rejects(hosts.launch('../arbitrary',{}),/host/i);hosts.close();
});
test('cancelling a connection passes cancellation to the owned launcher process',async()=>{
 const abort=new AbortController();let forwarded;
 const hosts=createWindowsHosts({paths:{runtime:'C:/fixture/runtime'},exec:async(file,args,options)=>{forwarded=options.signal;abort.abort();return {stdout:'{"ok":true,"session":{}}'}}});
 await assert.rejects(hosts.launch('codex-desktop',{generation:2,signal:abort.signal}),{name:'AbortError'});assert.equal(forwarded,abort.signal);hosts.close();
});

test('cosmetic taskbar checks do not delay transport and are aborted on close',async()=>{
 let cosmeticSignal,release;const gate=new Promise(r=>release=r),calls=[];
 const hosts=createWindowsHosts({paths:{runtime:'fixture'},exec:async(file,args,options)=>{calls.push(args);if(args.includes('-HostId'))return {stdout:JSON.stringify({ok:true,session:{runDirectory:'fixture/session'}})};cosmeticSignal=options.signal;await gate;return {stdout:'{}'}}});
 const session=await hosts.launch('codex-desktop');assert.equal(session.runDirectory,'fixture/session');assert.ok(calls[0].includes('-ConnectOnly'));assert.equal(calls.length,2);hosts.close();assert.equal(cosmeticSignal.aborted,true);release();
});
