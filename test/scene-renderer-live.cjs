const {SceneEngine}=require('../src/scene-engine.cjs');
const {readSceneConfig}=require('../src/scene-server.cjs');
const fs=require('node:fs/promises');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {delay}=require('../src/control.cjs');
(async()=>{const engine=new SceneEngine(await readSceneConfig());try{
  console.log('Starting isolated WebWallGL renderer');await engine.start();
  const first=await engine.frame();await delay(1200);const second=await engine.frame();
  assert.notEqual(createHash('sha256').update(first).digest('hex'),createHash('sha256').update(second).digest('hex'),'Live scene should change over time');
  await engine.pause();assert.equal(engine.status.state,'paused');await engine.resume();assert.equal(engine.status.state,'ready');
  await fs.writeFile('.state/scene-live-preview.jpg',Buffer.from(second.split(',')[1],'base64'));
  console.log(JSON.stringify({...engine.status,framesDiffer:true,pauseResume:true},null,2));
}finally{await engine.close()}})().catch(e=>{console.error(e.stack);process.exitCode=1});
