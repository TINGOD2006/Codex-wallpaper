const {test}=require('node:test'),assert=require('node:assert/strict');
const {SceneEngine}=require('../../src/scene-engine.cjs');
test('overlapping pause and resume finish in order without cancelling capture startup',async()=>{
 const engine=new SceneEngine({}),calls=[];let release;const blocked=new Promise(resolve=>release=resolve);
 engine.client={connected:true,evaluate:async expression=>{calls.push(expression.includes('pause()')?'pause':'resume');if(calls.length===1)await blocked}};
 engine.stream={stop:async()=>calls.push('stop'),start:async()=>calls.push('start')};
 const pause=engine.pause(),resume=engine.resume();await new Promise(setImmediate);release();await Promise.all([pause,resume]);
 assert.deepEqual(calls,['pause','stop','resume','start']);assert.equal(engine.status.state,'ready');
});
