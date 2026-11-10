const {test}=require('node:test'),assert=require('node:assert/strict');
const {createRendererPool}=require('../../src/renderer/pool.cjs');
function fixture(intercept=async()=>{}){
 const calls=[];let pages=0,maximum=0,stops=0;
 const browser={async start(){return {browserGeneration:1}},async openTarget(){pages++;maximum=Math.max(maximum,pages);let closed=false;return {client:{},async close(){if(!closed){closed=true;await new Promise(r=>setImmediate(r));pages--}}}},async stop(){stops++}};
 const origin={async register(entry,{identity}){return {leaseId:identity.leaseId,frameId:entry.id,rendererUrl:'http://127.0.0.1:1234/'+entry.id+'/',async revoke(){}}}};
 const makeRenderer=async options=>{await intercept(options);return {status:{state:'ready'},async frame(){return options.registration.frameId},async close(){calls.push('close:'+options.registration.frameId);await options.target.close();await options.registration.revoke()},async pause(){},async resume(){},async setPlayback(){}}};
 const pool=createRendererPool({browser,origin,makeRenderer,idleMs:5});return {pool,calls,get maximum(){return maximum},get pages(){return pages},get stops(){return stops}};
}
const opts={entryFingerprint:'a'.repeat(64),managerInstance:'fixture',hostGeneration:1};
test('promotion retires old access and rollback preserves old playback without resuming it',async()=>{const f=fixture(),a=await f.pool.prepare({id:'A'},{},opts);await a.promote();const b=await f.pool.prepare({id:'B'},{},opts);await b.rollback();assert.equal(await a.frame(),'A');const c=await f.pool.prepare({id:'C'},{},opts);await c.promote();await assert.rejects(a.frame(),{code:'POOL_CLOSED'});assert.equal(f.maximum,2);await a.close();await c.close();await new Promise(r=>setTimeout(r,20));assert.equal(f.pages,0);assert.equal(f.stops,1);await f.pool.close()});
test('obsolete candidates cannot promote and closing pool releases all leases',async()=>{const f=fixture(),a=await f.pool.prepare({id:'A'},{},opts),b=await f.pool.prepare({id:'B'},{},opts);await assert.rejects(a.promote(),{code:'POOL_CLOSED'});await b.promote();await f.pool.close();assert.equal(f.pages,0);await assert.rejects(f.pool.prepare({id:'C'},{},opts),{code:'POOL_CLOSED'})});
test('rapid selection cancels and drains the old candidate before creating the latest page',async()=>{
 let entered;const started=new Promise(r=>{entered=r});
 const f=fixture(async options=>{if(options.registration.frameId==='B'){entered();await new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}))}});
 const a=await f.pool.prepare({id:'A'},{},opts);await a.promote();const b=f.pool.prepare({id:'B'},{},opts);b.catch(()=>{});await started;
 const c=await f.pool.prepare({id:'C'},{},opts);await assert.rejects(b);await c.promote();assert.equal(f.maximum,2);assert.equal(await c.frame(),'C');await f.pool.close();assert.equal(f.pages,0);
});
