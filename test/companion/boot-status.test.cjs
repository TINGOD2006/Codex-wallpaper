const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {sessionState,feedBootStatus}=require('../../src/companion/boot-status.cjs');
const id='12345678-1234-1234-1234-123456789abc',host={pid:42,startTime:'12345',appPath:'C:/Official/ChatGPT.exe'};
test('animation readiness requires real applied proof or a connected host with disabled wallpaper',()=>{
 assert.equal(sessionState(id,{desired:{enabled:true},observed:{applied:false}},host).Ready,false);
 const loading=sessionState(id,{observed:{applied:true},playback:{preview:true,state:'loading'}},host);assert.equal(loading.Ready,true);assert.equal(loading.HostPid,42);assert.equal(loading.LaunchId,id);
 assert.equal(sessionState(id,{desired:{enabled:false},observed:{connected:true}},host).Ready,true);assert.equal(sessionState(id,{desired:{enabled:false},observed:{connected:false}},host).Ready,false);assert.equal(sessionState(id,{observed:{applied:true}},null).Ready,false);
 assert.equal(sessionState(id,{error:{code:'ADAPTER_LAYOUT_MISMATCH'},observed:{applied:false}},host).Failed,true);
 assert.equal(sessionState(id,{error:{code:'HOST_ENDPOINT_PENDING'},observed:{applied:false}},host).Failed,false);
 const hung=sessionState(id,{desired:{enabled:false},error:{code:'HOST_UNRESPONSIVE'},observed:{hostUnresponsive:true,applied:false,connected:true}},host);
 assert.equal(hung.Ready,false);assert.equal(hung.Failed,false);assert.equal(hung.HostPid,42);
 assert.equal(sessionState(id,{error:{code:'HOST_ENDPOINT_TIMEOUT'},observed:{applied:false}},host).Failed,true);
 assert.equal(sessionState(id,{error:{code:'RENDERER_FAILED'},observed:{applied:true}},host).Failed,false);
});
test('animation feed reuses authenticated client, writes only scoped metadata and ends on player completion',async()=>{
 const paths={runtime:path.resolve('fixture/runtime')},statePath=path.join(paths.runtime,'boot-animation',id+'.json'),writes=[];let now=0,connects=0,closed=0,requests=0;
 await feedBootStatus({paths,statePath,launchId:id,playerPid:123,now:()=>now,sleep:async ms=>{now+=ms},alive:()=>true,read:async file=>{if(file.endsWith('.result.json')){if(requests>=2)return JSON.stringify({launchId:id});throw Error('pending')}return 'descriptor'},write:async(file,value)=>{assert.equal(file,statePath);writes.push(value)},connect:async()=>{connects++;return {request:async action=>{assert.equal(action,'caption-host');requests++;return {state:{observed:{applied:requests>=2}},result:{host}}},close(){closed++}}}});
 assert.equal(connects,1);assert.equal(closed,1);assert.equal(writes.length,2);assert.equal(writes[1].Ready,true);assert.deepEqual(Object.keys(writes[1]),['LaunchId','HostPid','HostStartTime','HostPath','Ready','Failed']);
});
test('animation feed is bounded and never accepts paths outside its launch scope',async()=>{
 const paths={runtime:path.resolve('fixture/runtime')};await assert.rejects(feedBootStatus({paths,statePath:'outside.json',launchId:id,playerPid:1}),/scope/);
 let now=0,attempts=0;await feedBootStatus({paths,statePath:path.join(paths.runtime,'boot-animation',id+'.json'),launchId:id,playerPid:1,timeoutMs:1000,now:()=>now,sleep:async ms=>{now+=ms},alive:()=>true,read:async()=>{throw Error('absent')},connect:async()=>{attempts++}});assert.equal(now,1000);assert.equal(attempts,0);
});
