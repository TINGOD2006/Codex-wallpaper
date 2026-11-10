const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {createBrowserOwner}=require('../../src/renderer/browser-owner.cjs'),{createAssetOrigin}=require('../../src/renderer/asset-origin.cjs'),{probeCapabilities,createPooledRenderer}=require('../../src/renderer/pooled-renderer.cjs'),{fingerprintEntry}=require('../../src/renderer/source-fingerprint.cjs');
const {createLibrary,discoverSteamRoots}=require('../../src/wallpaper/library.cjs'),{defaults}=require('../../src/wallpaper/schema.cjs'),{delay}=require('../../src/control.cjs');
(async()=>{
 const root=path.resolve('.state/capabilities-live-'+Date.now()),paths={runtime:path.join(root,'runtime'),data:path.join(root,'data')},owner=createBrowserOwner({paths}),origin=createAssetOrigin({paths}),library=createLibrary({roots:await discoverSteamRoots(),dataRoot:paths.data,runtimeRoot:paths.runtime});let renderer;
 try{
  await origin.start();const capabilities=await probeCapabilities(owner,origin);console.log(JSON.stringify({stage:'capabilities',...capabilities}));assert.equal(capabilities.multiWindow,true);
  await library.scan();const scene=library.cards(defaults()).find(c=>c.kind==='scene'&&c.id.endsWith(':2804379697'))||library.cards(defaults()).find(c=>c.kind==='scene'&&c.capability==='supported');assert.ok(scene,'No installed Scene fixture');
  const videoDir=path.join(root,'video');await fs.mkdir(videoDir,{recursive:true});await fs.copyFile(path.resolve('test/wallpaper/fixtures/motion.webm'),path.join(videoDir,'motion.webm'));await fs.writeFile(path.join(videoDir,'project.json'),JSON.stringify({type:'video',file:'motion.webm'}));
  const entries=[library.get(scene.id),{id:'fixture:motion',kind:'video',directory:videoDir,mediaPath:path.join(videoDir,'motion.webm')}],results=[];
  for(const entry of entries){const playback={...defaults().playback,width:1920,height:1020},entryFingerprint=await fingerprintEntry(entry,{}),registration=await origin.register(entry,{entryFingerprint,playback}),identity={leaseId:registration.leaseId,entryFingerprint,rendererGeneration:1};const target=await owner.openTarget({url:registration.rendererUrl,width:playback.width,height:playback.height});
   renderer=await createPooledRenderer({target,registration,identity,playback,kind:entry.kind});const first=await renderer.frame();await delay(1300);const second=await renderer.nextFrame();assert.notEqual(first,second);await renderer.pause();assert.equal(renderer.status.state,'paused');await renderer.resume();assert.equal(renderer.status.state,'ready');
   results.push({kind:entry.kind,...renderer.status});await renderer.close();renderer=null;
  }
  await fs.writeFile(path.join(root,'result.json'),JSON.stringify({capabilities,results},null,2));console.log(JSON.stringify({passed:true,results}));
 }finally{await renderer?.close();await library.close();await owner.close();await origin.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
