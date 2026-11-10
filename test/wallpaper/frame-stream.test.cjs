const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {FrameStream}=require('../../src/frame-stream.cjs');
class Client extends EventEmitter{
 constructor(){super();this.connected=true;this.calls=[]}
 async send(method,params={}){this.calls.push({method,params});if(method==='Page.startScreencast')queueMicrotask(()=>this.push(1,'first'));return {}}
 push(sessionId,data){this.emit('notification',{method:'Page.screencastFrame',params:{sessionId,data,metadata:{deviceWidth:640,deviceHeight:400}}})}
}
test('frame stream holds only the latest frame and acknowledges every capture',async()=>{
 const c=new Client(),s=new FrameStream(c,{width:640,height:400,renderFps:30,displayFps:30},{measureFrame:()=>({width:640,height:400})});await s.start();assert.equal(s.frame,'data:image/jpeg;base64,first');c.push(2,'second');c.push(3,'latest');assert.equal(s.frame,'data:image/jpeg;base64,latest');assert.deepEqual(c.calls.filter(x=>x.method==='Page.screencastFrameAck').map(x=>x.params.sessionId),[1,2,3]);
 await s.stop();c.push(4,'after-stop');assert.equal(s.frame,'data:image/jpeg;base64,latest');await s.start();assert.equal(s.frame,'data:image/jpeg;base64,first');await s.close();assert.equal(c.listenerCount('notification'),0);assert.equal(s.frame,null);
});
test('closing during first-frame wait cancels readiness without retaining callbacks',async()=>{
 const c=new Client();c.send=async function(method,params){this.calls.push({method,params});return {}};const s=new FrameStream(c,{width:640,height:400,renderFps:30,displayFps:30},{measureFrame:()=>({width:640,height:400})});const starting=s.start();const rejected=assert.rejects(starting,/closed|cancel/i);await new Promise(setImmediate);await s.close();await rejected;assert.equal(c.listenerCount('notification'),0);
});
test('new-frame waits follow capture events and are released when stopped',async()=>{
 const c=new Client(),s=new FrameStream(c,{width:640,height:400,renderFps:30,displayFps:30},{measureFrame:()=>({width:640,height:400})});await s.start();assert.equal(await s.next(),'data:image/jpeg;base64,first');let completed=false;const next=s.next().then(frame=>{completed=true;return frame});await new Promise(setImmediate);assert.equal(completed,false);c.push(2,'new-frame');assert.equal(await next,'data:image/jpeg;base64,new-frame');const stopping=s.next();await s.stop();assert.equal(await stopping,'data:image/jpeg;base64,new-frame');await s.close();assert.equal(c.listenerCount('disconnected'),0);
});
test('cropped compositor frames trigger bounded window-size correction instead of being displayed',async()=>{
 const c=new Client(),base=c.send.bind(c);c.send=async(method,params)=>{if(method==='Browser.getWindowForTarget'){c.calls.push({method,params});return {windowId:9,bounds:{width:640,height:400}}}const result=await base(method,params);if(method==='Browser.setWindowBounds')queueMicrotask(()=>c.push(3,'repaired'));return result};
 const s=new FrameStream(c,{width:640,height:400,renderFps:30,displayFps:30},{measureFrame:()=>({width:640,height:400})});try{await s.start();await s.next();const waiting=s.next();c.emit('notification',{method:'Page.screencastFrame',params:{sessionId:2,data:'cropped',metadata:{deviceWidth:614,deviceHeight:273}}});assert.equal(await waiting,'data:image/jpeg;base64,repaired');assert.deepEqual(c.calls.find(x=>x.method==='Browser.setWindowBounds').params,{windowId:9,bounds:{width:666,height:527}})}finally{await s.close()}
});
test('JPEG dimensions trigger repair even when emulation metadata incorrectly claims a complete frame',async()=>{
 const jpeg=(width,height)=>Buffer.from([255,216,255,192,0,17,8,height>>8,height&255,width>>8,width&255,3,1,17,0,2,17,0,3,17,0,255,217]).toString('base64');
 const c=new Client();c.send=async(method,params)=>{c.calls.push({method,params});if(method==='Page.startScreencast')queueMicrotask(()=>c.push(1,jpeg(640,283)));if(method==='Browser.getWindowForTarget')return {windowId:3,bounds:{width:640,height:400}};if(method==='Browser.setWindowBounds')queueMicrotask(()=>c.push(2,jpeg(640,400)));return {}};
 const stream=new FrameStream(c,{width:640,height:400,renderFps:15,displayFps:15});try{await stream.start();assert.equal(stream.sequence,1);assert.equal(stream.received,2);assert.deepEqual(c.calls.find(c=>c.method==='Browser.setWindowBounds').params,{windowId:3,bounds:{width:640,height:517}});assert.equal(stream.frame,'data:image/jpeg;base64,'+jpeg(640,400))}finally{await stream.close()}
});
