const path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
const {prepareRenderer}=require('../../src/wallpaper/renderer.cjs');
const {createLibrary,discoverSteamRoots}=require('../../src/wallpaper/library.cjs');
const {defaults}=require('../../src/wallpaper/schema.cjs');
const {delay}=require('../../src/control.cjs');
(async()=>{
  const library=createLibrary({roots:await discoverSteamRoots(),dataRoot:path.resolve('.state/wallpaper-renderer-test')});await library.scan();
  const scene=library.cards(defaults()).find(c=>c.kind==='scene'&&c.id.endsWith(':3172471800'));assert.ok(scene,'Installed Scene fixture missing');
  const playback={...defaults().playback,width:1920,height:1020,renderFps:30,displayFps:30},renderer=await prepareRenderer(library.get(scene.id),playback),samples=[];
  try{
    // Wait beyond headless Edge's delayed native-window initialization.
    let sequence=0;
    for(let i=0;i<4;i++){
      await delay(4000);const frame=await renderer.nextFrame(),status=renderer.status;
      assert.match(frame,/^data:image\/jpeg;base64,/);assert.equal(status.captureMode,'screencast');
      assert.deepEqual(status.captureDiagnostics.lastViewport,[1920,1020]);assert.ok(status.captureDiagnostics.sequence>sequence,'Late frames must continue advancing');
      sequence=status.captureDiagnostics.sequence;samples.push({seconds:(i+1)*4,sequence,captureFps:status.captureFps});
    }
    // Resize only this test renderer to reproduce the compositor crop.
    const window=await renderer.client.send('Browser.getWindowForTarget');
    await renderer.client.send('Browser.setWindowBounds',{windowId:window.windowId,bounds:{width:1920,height:1020}});
    await delay(3500);await renderer.nextFrame();
    assert.equal(renderer.status.captureMode,'screencast');assert.deepEqual(renderer.status.captureDiagnostics.lastViewport,[1920,1020]);assert.ok(renderer.status.captureDiagnostics.sequence>sequence);
    await renderer.pause();assert.equal(renderer.eventDriven,false);
    await renderer.resume();await renderer.nextFrame();assert.equal(renderer.eventDriven,true);
    await renderer.setPlayback({...playback,displayFps:15});await delay(1200);await renderer.nextFrame();assert.equal(renderer.status.captureMode,'screencast');
    const result={width:1920,height:1020,jpegQuality:92,samples,cropRecovery:true,pauseResume:true,rateChange:true};
    await fs.mkdir('.state/validation',{recursive:true});await fs.writeFile('.state/validation/stream-stability.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }finally{await renderer.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
