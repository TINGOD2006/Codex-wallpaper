const {test}=require('node:test'),assert=require('node:assert/strict');
const {waitForCompanion,launchAndWait}=require('../../src/companion/launch-readiness.cjs');
function clock(){let t=0;return {now:()=>t,delay:async ms=>{t+=ms}}}
test('cold readiness waits for descriptor, verifies once and reuses the client',async()=>{
 const c=clock(),client={},paths={runtime:'fixture'};let reads=0,checks=0;
 const value=await waitForCompanion({paths,...c,read:async()=>{if(++reads<5)throw Object.assign(Error(),{code:'ENOENT'});return 'new-instance'},connect:async()=>{checks++;return client}});
 assert.equal(value,client);assert.equal(checks,1);assert.equal(reads,5);
});
test('a stale service descriptor cannot trigger an identity-verifier storm or bypass verification',async()=>{
 const c=clock();let checks=0;
 await assert.rejects(waitForCompanion({paths:{runtime:'fixture'},...c,timeoutMs:5000,read:async()=> 'stale',connect:async()=>{checks++;throw Object.assign(Error(),{code:'COMPANION_IDENTITY_UNVERIFIED'})}}),{code:'COMPANION_START_TIMEOUT'});
 assert.equal(checks,3);
});
test('changed descriptor retries promptly and permission failures remain errors',async()=>{
 const c=clock(),client={};let reads=0,checks=0;
 const value=await waitForCompanion({paths:{runtime:'fixture'},...c,read:async()=>++reads===1?'stale':'replacement',connect:async()=>{if(++checks===1)throw Error('dead');return client}});assert.equal(value,client);assert.equal(checks,2);assert.equal(c.now(),200);
 await assert.rejects(waitForCompanion({paths:{runtime:'fixture'},...c,read:async()=>{throw Object.assign(Error(),{code:'EACCES'})}}),{code:'EACCES'});
});
test('launch waits for inventory and the same authenticated client observes eventual readiness',async()=>{
 const c=clock(),actions=[];let polls=0;
 const final={phase:'active',hosts:[{id:'codex-desktop'}],observed:{connected:true}};
 const client={request:async action=>{actions.push(action);assert.equal(action,'status');polls++;return {state:polls<3?{phase:'connecting',hosts:[]} : polls>4?final:{...final,phase:'connecting',observed:{connected:false}}}}};
 assert.equal((await launchAndWait(client,{...c})).state.phase,'active');assert.equal(actions.filter(a=>a==='launch').length,0);
});
test('hot shortcut does not activate or launch a second native host',async()=>{
 const actions=[],state={phase:'active',hosts:[{id:'codex-desktop'}],observed:{connected:true}};
 assert.deepEqual((await launchAndWait({request:async action=>{actions.push(action);return {state}}})).state,state);assert.deepEqual(actions,['status']);
});
test('unsupported native endpoint ends waiting without retrying launch or hiding the error',async()=>{
 const c=clock();let launches=0;const hosts=[{id:'codex-desktop'}];
 const result=await launchAndWait({request:async action=>{if(action==='launch'){launches++;return {state:{phase:'needs-launch',error:{code:'HOST_NEEDS_MANAGED_LAUNCH'},hosts}}}return {state:{phase:'idle',hosts}}}},{...c});assert.equal(result.state.error.code,'HOST_NEEDS_MANAGED_LAUNCH');assert.equal(launches,1);assert.equal(c.now(),0);
});
test('an endpoint still starting returns pending within the launcher budget without blocking on another launch',async()=>{
 const c=clock(),state={phase:'checking',hosts:[{id:'codex-desktop'}],observed:{connected:false},error:{code:'HOST_ENDPOINT_PENDING'}};
 const result=await launchAndWait({request:async action=>{assert.equal(action,'status');return {state}}},{...c,timeoutMs:1000});assert.equal(result.state.error.code,'HOST_ENDPOINT_PENDING');assert.equal(c.now(),1000);
});
test('missing inventory times out rather than silently treating native launch as wallpaper success',async()=>{
 const c=clock();await assert.rejects(launchAndWait({request:async()=>({state:{phase:'connecting',hosts:[]}})},{...c,timeoutMs:1000}),{code:'HOST_NOT_FOUND'});
});
