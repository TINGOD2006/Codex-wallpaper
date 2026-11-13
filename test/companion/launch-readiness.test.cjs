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
 assert.equal((await launchAndWait(client,{...c})).state.phase,'active');assert.ok(actions.every(action=>action==='status'));
});
test('hot shortcut does not activate or launch a second native host',async()=>{
 const actions=[],state={phase:'active',hosts:[{id:'codex-desktop'}],observed:{connected:true}};
 assert.deepEqual((await launchAndWait({request:async action=>{actions.push(action);return {state}}})).state,state);assert.deepEqual(actions,['status']);
});
test('a cold shortcut wakes passive attachment and preserves an unsupported-host result',async()=>{
 const c=clock(),actions=[];const hosts=[{id:'codex-desktop'}];
 const result=await launchAndWait({initial:{state:{phase:'idle',hosts}},request:async action=>{
  actions.push(action);return {state:{phase:'needs-launch',error:{code:'HOST_NEEDS_MANAGED_LAUNCH'},hosts}};
 }},c);
 assert.equal(result.state.error.code,'HOST_NEEDS_MANAGED_LAUNCH');assert.deepEqual(actions,['attach-existing']);assert.equal(c.now(),0);
});
test('an endpoint still starting returns pending within the launcher budget without blocking on another launch',async()=>{
 const c=clock(),state={phase:'checking',hosts:[{id:'codex-desktop'}],observed:{connected:false},error:{code:'HOST_ENDPOINT_PENDING'}};
 const result=await launchAndWait({request:async action=>{assert.equal(action,'status');return {state}}},{...c,timeoutMs:1000});assert.equal(result.state.error.code,'HOST_ENDPOINT_PENDING');assert.equal(c.now(),1000);
});
test('missing inventory stays pending while discovery continues off the launcher',async()=>{
 const c=clock(),state={phase:'connecting',hosts:[]};
 const result=await launchAndWait({request:async()=>({state})},{...c,timeoutMs:1000});
 assert.equal(result.state,state);assert.equal(c.now(),1000);
});
test('a slow status call receives only the remaining budget and returns the last honest state',async()=>{
 const c=clock(),state={phase:'checking',observed:{connected:false,applied:false}},budgets=[];
 const client={initial:{state},async request(action,payload,{timeoutMs}){
  assert.equal(action,'status');budgets.push(timeoutMs);await c.delay(timeoutMs);throw new DOMException('Timed out','TimeoutError');
 }};
 assert.deepEqual(await launchAndWait(client,{...c,timeoutMs:1000}),{state});assert.deepEqual(budgets,[750]);assert.equal(c.now(),1000);
});
