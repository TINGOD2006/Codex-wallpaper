const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {sendCommand,consumeCommands}=require('../src/control.cjs');
const {atomicJson}=require('../src/config.cjs');
async function fixture(t){
  const base=path.join(__dirname,'../.state/tests');await fs.mkdir(base,{recursive:true});
  const root=await fs.mkdtemp(path.join(base,'control-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await atomicJson(path.join(root,'session.json'),{sessionId:'managed-session'});return root;
}
test('concurrent commands receive their own results and stale sessions cannot apply',async t=>{
  const root=await fixture(t);
  let enabled=false;
  const handler=async action=>({enabled:enabled=action==='apply'});
  const a=sendCommand(root,'apply',{timeoutMs:1500,pollMs:10});
  const b=sendCommand(root,'disable',{timeoutMs:1500,pollMs:10});
  let stop=false;
  const worker=(async()=>{while(!stop){await consumeCommands(root,'managed-session',handler);await new Promise(resolve=>setTimeout(resolve,10));}})();
  try {assert.deepEqual(await a,{enabled:true});assert.deepEqual(await b,{enabled:false});}
  finally {stop=true;await worker;}
  const previous=enabled;
  await atomicJson(path.join(root,'commands/stale.json'),{id:'stale',sessionId:'old',action:'apply'});
  await consumeCommands(root,'managed-session',handler);
  const rejected=JSON.parse(await fs.readFile(path.join(root,'results/stale.json'),'utf8'));
  assert.ok(rejected.error);assert.equal(enabled,previous);
});
test('an unavailable loader times out instead of reporting success',async t=>{
  const root=await fixture(t);
  await assert.rejects(()=>sendCommand(root,'disable',{timeoutMs:30,pollMs:5}),/timed out/);
});
