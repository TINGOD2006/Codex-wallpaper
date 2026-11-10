// Exercises only our own background controls; never edits or sends chat content.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {connectManaged}=require('../src/cli.cjs'),{delay}=require('../src/control.cjs');
(async()=>{
  const {client}=await connectManaged(path.resolve('.state/session.json'));
  const state=async()=>JSON.parse(await fs.readFile('.state/status.json','utf8'));
  async function wait(predicate){for(let i=0;i<100;i++){const s=await state();if(predicate(s))return s;await delay(200)}throw new Error('Control did not settle: '+JSON.stringify(await state()))}
  const click=()=>client.evaluate(`document.getElementById('miku-desktop-theme-toggle').click()`);
  const geometry=()=>client.evaluate(`['[data-app-shell-active-page="true"] main[data-app-shell-main-surface="default"]','.app-shell-left-panel','[data-app-shell-active-page="true"] [data-composer-body]'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return [r.x,r.y,r.width,r.height]})`);
  try{
    await wait(s=>s.scene?.state==='playing'&&s.scene.displayedFrames>5);const before=await geometry();
    await click();await wait(s=>s.state==='disabled'&&!s.sceneSelected);
    assert.equal(await client.evaluate(`!!document.getElementById('miku-live-scene-layer')`),false);
    await click();await wait(s=>s.state==='applied'&&!s.sceneSelected);
    await click();const live=await wait(s=>s.scene?.state==='playing'&&s.sceneSelected);
    assert.deepEqual(await geometry(),before);
    const count=await client.evaluate(`document.querySelectorAll('#miku-live-scene-layer').length`);assert.equal(count,1);
    const shot=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile('.state/scene-integrated-preview.png',Buffer.from(shot.data,'base64'));
    const report={originalStaticLiveCycle:true,geometryUnchanged:true,singleLiveLayer:true,live:live.scene,sentMessages:false};await fs.writeFile('.state/scene-controls-validation.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{client.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
