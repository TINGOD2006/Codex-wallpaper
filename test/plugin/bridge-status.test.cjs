const {test}=require('node:test'),assert=require('node:assert/strict');
const {createPluginBridge}=require('../../plugins/codex-wallpaper-control/bridge.cjs');
test('connection failures preserve a safe reason without starting a manager or leaking details',async()=>{
 for(const [code,expected]of [['ENOENT','COMPANION_NOT_STARTED'],['ECONNREFUSED','COMPANION_UNREACHABLE'],['COMPANION_IDENTITY_UNVERIFIED','COMPANION_IDENTITY_UNVERIFIED'],['secret-private-code','COMPANION_CONNECTION_FAILED']]){
  let starts=0;const bridge=createPluginBridge({connect:async()=>{throw Object.assign(Error('private token and path'),{code})},startManager:async()=>{starts++}});
  const state=await bridge.status();assert.equal(state.error?.code,expected);assert.equal(state.observed.applied,false);assert.equal(starts,0);assert.equal(JSON.stringify(state).includes('private token'),false);
 }
});
test('a fetch cause is classified and a later successful connection clears offline state',async()=>{
 let calls=0;const bridge=createPluginBridge({connect:async()=>{if(!calls++)throw Object.assign(Error('fetch failed'),{cause:{code:'ECONNREFUSED'}});return {request:async()=>({state:{phase:'disabled',error:null,observed:{connected:true,applied:false}}}),close(){}}}});
 assert.equal((await bridge.status()).error?.code,'COMPANION_UNREACHABLE');assert.equal((await bridge.status()).observed.connected,true);
});
