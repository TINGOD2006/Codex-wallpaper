const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {WindowMonitor}=require('../src/window-monitor.cjs');

test('restoring waits for a stable visible interval and repeated samples do not postpone it',()=>{
 let now=0,child;const monitor=new WindowMonitor('fixture.json',{now:()=>now,spawnProcess(){child=new EventEmitter();child.stdout=Object.assign(new EventEmitter(),{setEncoding(){}});child.kill=()=>{};return child}});
 try{child.stdout.emit('data','{"visible":true}\n');assert.equal(monitor.stableVisible,false);now=300;child.stdout.emit('data','{"visible":true}\n');now=500;assert.equal(monitor.stableVisible,true);child.stdout.emit('data','{"visible":false}\n');assert.equal(monitor.stableVisible,false);now=1000;child.stdout.emit('data','{"visible":true}\n');now=1499;assert.equal(monitor.stableVisible,false);now=1500;assert.equal(monitor.stableVisible,true)}finally{monitor.close()}
});
test('visibility monitoring recovers after exit, ignores old samples and never restarts after close',()=>{
 const children=[],timers=new Map();let id=0;
 const monitor=new WindowMonitor('fixture.json',{spawnProcess(){const child=new EventEmitter();child.stdout=new EventEmitter();child.stdout.setEncoding=()=>{};child.kill=()=>child.emit('exit',0);children.push(child);return child},clock:{setTimeout(fn,ms){const key=++id;timers.set(key,{fn,ms});return key},clearTimeout(key){timers.delete(key)}}});
 children[0].stdout.emit('data','{"visible":true}\n');assert.equal(monitor.visible,true);
 children[0].emit('exit',1);assert.equal(monitor.visible,false);assert.equal(timers.size,1);
 const timer=[...timers.values()][0];timers.clear();timer.fn();assert.equal(children.length,2);
 children[0].stdout.emit('data','{"visible":true}\n');assert.equal(monitor.visible,false);
 children[1].stdout.emit('data','{"visible":true}\n');assert.equal(monitor.visible,true);
 children[1].emit('error',new Error('lost'));assert.equal(timers.size,1);monitor.close();assert.equal(timers.size,0);
});
