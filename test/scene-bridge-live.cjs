const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {connectManaged}=require('../src/cli.cjs'),{SceneBridge,LAYER_ID}=require('../src/scene-bridge.cjs');
const {readSceneConfig}=require('../src/scene-server.cjs'),{loadConfig}=require('../src/config.cjs'),{delay}=require('../src/control.cjs');
(async()=>{
  const {client}=await connectManaged(path.resolve('.state/session.json'));
  const scene=new SceneBridge(client,{...await readSceneConfig(),pauseWhenHidden:false},await loadConfig('config.json'));
  const measure=()=>client.evaluate(`(()=>{const select=['[data-app-shell-active-page="true"] main[data-app-shell-main-surface="default"]','.app-shell-left-panel','[data-app-shell-active-page="true"] [data-composer-body]'];return {geometry:select.map(s=>{const r=document.querySelector(s).getBoundingClientRect();return [r.x,r.y,r.width,r.height]}),policy:document.querySelector('meta[http-equiv="Content-Security-Policy"]').content}})()`);
  try{
    const before=await measure();await scene.setActive(true);
    for(let i=0;i<120;i++){if(scene.status.state==='error')throw new Error(scene.status.error);if(scene.status.displayedFrames>=8)break;await delay(250)}
    assert.ok(scene.status.displayedFrames>=8,'Bridge should display advancing live frames');assert.deepEqual(await measure(),before);
    const layer=await client.evaluate(`(()=>{const e=document.getElementById('${LAYER_ID}');return {count:document.querySelectorAll('#${LAYER_ID}').length,pointer:e&&getComputedStyle(e).pointerEvents,img:e?.firstElementChild.naturalWidth}})()`);
    assert.equal(layer.count,1);assert.equal(layer.pointer,'none');assert.ok(layer.img>0);
    const shot=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile('.state/scene-bridge-preview.png',Buffer.from(shot.data,'base64'));
    console.log(JSON.stringify({...scene.status,geometryUnchanged:true,hostCspUnchanged:true,clickThrough:true},null,2));
    await scene.setActive(false);assert.equal(await client.evaluate(`!!document.getElementById('${LAYER_ID}')`),false);
  }finally{await scene.close();client.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
