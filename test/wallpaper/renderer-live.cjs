const path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
const {prepareRenderer}=require('../../src/wallpaper/renderer.cjs');
const {createLibrary,discoverSteamRoots}=require('../../src/wallpaper/library.cjs');
const {defaults}=require('../../src/wallpaper/schema.cjs');
const {delay}=require('../../src/control.cjs');
(async()=>{
  const library=createLibrary({roots:await discoverSteamRoots(),dataRoot:path.resolve('.state/wallpaper-renderer-test')});await library.scan();
  const scene=library.cards(defaults()).find(c=>c.kind==='scene'&&c.id.endsWith(':3172471800'));assert.ok(scene,'Installed Scene fixture missing');
  const video={id:'fixture:video',kind:'video',directory:path.resolve('test/wallpaper/fixtures'),mediaPath:path.resolve('test/wallpaper/fixtures/motion.webm'),title:'Synthetic test video',capability:'supported'};
  for(const entry of [library.get('builtin:miku'),library.get(scene.id),video]){
    const prepared=new AbortController();const renderer=await prepareRenderer(entry,{...defaults().playback,width:640,height:400},{signal:prepared.signal});
    try{
      prepared.abort(); // Once preparation returns, the controller owns this renderer's lifetime.
      const first=await renderer.frame();assert.match(first,/^data:image\//);
      if(entry.kind==='scene')assert.equal(renderer.status.captureMode,'screencast','Scene must use the measured streaming path on this Edge build');
      if(entry.kind==='image')assert.equal(renderer.child,undefined);
      else{await delay(1350);const second=await renderer.frame();assert.notEqual(second,first,'Media frames should advance');await renderer.pause();assert.equal(renderer.status.state,'paused');await renderer.resume();assert.equal(renderer.status.state,'ready')}
      console.log(JSON.stringify({kind:entry.kind,framesAdvance:entry.kind!=='image',state:renderer.status.state,captureMode:renderer.status.captureMode,captureFps:renderer.status.captureFps}));
    }finally{await renderer.close()}
  }
  const imported=await library.importFile(video.mediaPath);assert.ok(await library.thumbnail(imported.id),'Imported video needs a static poster');
  const badDirectory=path.resolve('.state/wallpaper-renderer-test/invalid');await fs.mkdir(badDirectory,{recursive:true});const badFile=path.join(badDirectory,'bad.mp4');await fs.writeFile(badFile,'invalid video');
  await assert.rejects(()=>prepareRenderer({...video,directory:badDirectory,mediaPath:badFile},defaults().playback),/解碼|編碼|decode|媒體/);
  const abort=new AbortController();const cancelled=prepareRenderer(library.get(scene.id),defaults().playback,{signal:abort.signal});setTimeout(()=>abort.abort(),80);await assert.rejects(()=>cancelled,/cancel|closed|exited/i);
  console.log('PASS: image without browser, Scene/video advancing frames, pause/resume, video poster.');
})().catch(e=>{console.error(e.stack);process.exitCode=1});
