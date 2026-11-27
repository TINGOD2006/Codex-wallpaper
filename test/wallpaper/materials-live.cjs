const path=require('node:path'),assert=require('node:assert/strict');
const {SceneEngine}=require('../../src/scene-engine.cjs'),{createLibrary}=require('../../src/wallpaper/library.cjs'),{WallpaperHost}=require('../../src/wallpaper/host.cjs'),{defaults}=require('../../src/wallpaper/schema.cjs'),{loadImage}=require('../../src/config.cjs');
const {MATERIAL_REGIONS,FULL_WINDOW_MATERIALS}=require('../../src/wallpaper/styles.cjs');
const fs=require('node:fs/promises'),{createRendererService}=require('../../src/renderer/service.cjs'),{WallpaperController}=require('../../src/wallpaper/controller.cjs'),{createStore}=require('../../src/wallpaper/store.cjs'),{delay}=require('../../src/control.cjs');
(async()=>{
 const library=createLibrary({roots:[],dataRoot:path.resolve('.state/material-fixture')});await library.scan();const image=library.get('builtin:miku'),engine=new SceneEngine({...defaults().playback,width:800,height:600,entry:image});let controller,service;
 try{
  await engine.start();await engine.pause();const client=engine.client,frame=(await client.send('Page.getFrameTree')).frameTree.frame.id;
  await client.send('Page.setDocumentContent',{frameId:frame,html:`<!doctype html><html><head><style>:root{--app-color-background-surface:#181818;--app-color-text-foreground:#fff;--app-color-text-danger:#ff5566}body{margin:0;color:#fff} [data-app-shell-frame]{position:relative;width:800px;height:600px}.app-shell-left-panel{position:absolute;left:0;top:40px;width:200px;height:560px;background:#181818}.app-shell-left-panel .sidebar-navigation{height:100%;background:rgb(24 24 24 / .65)}.sidebar-item{background:rgb(255 255 255 / .08)}.bg-surface{background:#181818}.bg-surface-elevated-secondary{background:#2d2d2d} main{position:absolute;left:200px;top:40px;width:600px;height:560px;background:#181818} [data-composer-surface-variant]{position:absolute;left:20px;bottom:20px;width:400px;height:70px;background:#363636} [data-composer-body],textarea{width:100%;height:100%} [data-app-shell-titlebar]{position:absolute;top:0;height:40px;width:800px;background:#181818} [class~="group/summary-panel"]{position:absolute;right:10px;top:50px;width:160px;height:150px;background:#2d2d2d} #codex-wallpaper-panel{position:absolute;right:10px;bottom:100px;width:160px;height:100px;background:#181818}button{width:100px;height:30px}</style></head><body><div id="root"><div data-app-shell-frame="true"><header data-app-shell-titlebar="true">fixture header</header><aside class="app-shell-left-panel"><div class="bg-surface sidebar-navigation"><div class="sidebar-item">fixture selected row</div><button aria-haspopup="menu" aria-label="目前模式：Codex">fixture mode</button></div></aside><div data-app-shell-active-page="true"><main data-app-shell-main-surface="default"><div class="group/summary-panel"><header class="bg-surface-elevated-secondary">fixture panel</header></div><div data-composer-surface-variant="default"><div data-composer-body><textarea>unsent fixture</textarea></div></div></main></div><aside id="codex-wallpaper-panel" data-owner="codex-wallpaper">owned fixture overlay</aside></div></div></body></html>`});
  const host=new WallpaperHost(client,'26.1023.6621.0');
  const inspect=()=>client.evaluate(`(()=>{const result={};for(const [name,selector]of Object.entries(${JSON.stringify(MATERIAL_REGIONS)})){const node=document.querySelector(selector),s=getComputedStyle(node),r=node.getBoundingClientRect();result[name]={background:s.backgroundColor,color:s.color,filter:s.filter,backdrop:s.backdropFilter,rect:[r.x,r.y,r.width,r.height]}}return result})()`);
  const before=await inspect(),s=defaults();s.materials=structuredClone(FULL_WINDOW_MATERIALS);s.reading.offsetX=-64;s.reading.offsetY=40;await host.apply(s);await host.paint((await loadImage(image.mediaPath)).dataUri);const after=await inspect();
  for(const name of Object.keys(MATERIAL_REGIONS)){assert.deepEqual(after[name].rect,before[name].rect);assert.equal(after[name].color,before[name].color);assert.equal(after[name].filter,'none');assert.equal(after[name].backdrop,'none');assert.notEqual(after[name].background,before[name].background,name+' should expose wallpaper')}
  assert.ok(await client.evaluate(`(()=>{const f=document.querySelector('[data-app-shell-frame]').getBoundingClientRect(),i=document.getElementById('codex-wallpaper-image').getBoundingClientRect();return i.left<=f.left&&i.top<=f.top&&i.right>=f.right&&i.bottom>=f.bottom})()`),'Panning must not leave uncovered edges');
  assert.equal(await client.evaluate(`getComputedStyle(document.querySelector('[class~="group/summary-panel"] header')).backgroundColor`),'rgba(0, 0, 0, 0)');
  assert.equal(await client.evaluate("getComputedStyle(document.querySelector('.sidebar-navigation')).backgroundColor"),'rgba(0, 0, 0, 0)');assert.equal(await client.evaluate("getComputedStyle(document.querySelector('.sidebar-item')).backgroundColor"),'rgba(255, 255, 255, 0.08)');
  // Codex home paints the input body; existing conversations paint its wrapper.
  const composerParts=await client.evaluate(`(()=>{
    const surface=document.querySelector('[data-composer-surface-variant]');
    const style=document.createElement('style');
    style.id='fixture-native-composer';
    style.textContent='[data-composer-utility-bar-variant="home"]{background-color:transparent}[data-composer-utility-bar-variant="home"] [data-composer-body]{background-color:rgb(54,54,54)}';
    document.head.append(style);
    return {body:getComputedStyle(surface.querySelector('[data-composer-body]')).backgroundColor};
  })()`);
  const inspectComposer=()=>client.evaluate(`(()=>{
    const surface=document.querySelector('[data-composer-surface-variant]');
    const body=surface.querySelector('[data-composer-body]');
    const editor=body.querySelector('textarea');
    return {surface:getComputedStyle(surface).backgroundColor,body:getComputedStyle(body).backgroundColor,
      blur:getComputedStyle(body).backdropFilter,shadow:getComputedStyle(body).boxShadow,
      draft:editor.value,rect:editor.getBoundingClientRect().toJSON()};
  })()`);
  const openHome=()=>client.evaluate(`document.querySelector('[data-composer-surface-variant]').setAttribute('data-composer-utility-bar-variant','home')`);
  const openThread=()=>client.evaluate(`document.querySelector('[data-composer-surface-variant]').removeAttribute('data-composer-utility-bar-variant')`);
  const glass=structuredClone(s);
  glass.materials.global={alpha:.6,blur:8,border:.12};
  glass.materials.composer.inherit=true;
  await host.apply(glass);
  const thread=await inspectComposer();
  assert.equal(thread.body,composerParts.body);
  await openHome();
  const home=await inspectComposer();
  assert.equal(home.surface,'rgba(0, 0, 0, 0)');
  assert.equal(home.body,thread.surface);
  assert.equal(home.blur,'blur(8px)');
  assert.match(home.shadow,/inset/);
  assert.equal(home.draft,thread.draft);
  assert.deepEqual(home.rect,thread.rect);
  await openThread();
  assert.deepEqual(await inspectComposer(),thread);
  await openHome();
  assert.deepEqual(await inspectComposer(),home);
  await client.evaluate(`(()=>{
    const active=document.querySelector('[data-app-shell-active-page="true"]');
    active.querySelector('[data-composer-body]').classList.add('bg-surface');
    const retained=active.cloneNode(true);
    retained.id='fixture-retained-page';
    retained.setAttribute('aria-hidden','true');
    active.after(retained);
  })()`);
  assert.deepEqual(await inspectComposer(),home);
  assert.equal((await host.inspect()).composerEditorCount,1);
  assert.equal((await host.inspect()).activeMainSurfaceCount,1);
  assert.equal(await client.evaluate(`getComputedStyle(document.querySelector('#fixture-retained-page [data-composer-body]')).backdropFilter`),'none');
  await client.evaluate(`document.getElementById('fixture-retained-page').remove();document.querySelector('[data-composer-body]').classList.remove('bg-surface')`);
  const noGlass=structuredClone(glass);
  noGlass.materials.composer.enabled=false;
  await host.apply(noGlass);
  assert.equal((await inspectComposer()).body,'rgb(54, 54, 54)');
  assert.equal((await inspectComposer()).blur,'none');
  await openThread();
  await client.evaluate(`document.getElementById('fixture-native-composer').remove()`);
  await host.apply(s);
  // Exercise the production maintenance task against a real, owned DOM.
  let calls=0;const measured=new WallpaperHost({evaluate:expression=>{calls++;return client.evaluate(expression)}},'26.1023.6621.0');
  await host.confirmImage((await loadImage(image.mediaPath)).dataUri);
  // Keep the cache through an incomplete shell and failed or pending decodes.
  const cache=(await loadImage(image.mediaPath)).dataUri;
  const replacement='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=';
  const displayed=()=>client.evaluate("document.getElementById('codex-wallpaper-image')?.getAttribute('src')");
  await client.evaluate("document.querySelector('button[aria-label]').setAttribute('aria-label','loading')");
  const documentToken=(await host.inspect()).documentToken;
  assert.equal(await host.showFallback(s,cache,'stale document'),false);
  assert.equal(await host.showFallback(s,cache,documentToken),true);
  assert.equal(await host.showFallback(s,replacement,documentToken,{existingOnly:true}),false);
  assert.equal(await host.showFallback(s,cache,documentToken,{existingOnly:true}),true);
  assert.equal(await displayed(),cache);
  assert.equal(await host.showFallback(s,'data:image/png;base64,YQ==',documentToken),false);
  assert.equal(await displayed(),cache);
  await assert.rejects(host.apply(s),{code:'HOST_SHELL_PENDING'});
  assert.equal(await displayed(),cache);
  await client.evaluate("document.querySelector('button[aria-label]').setAttribute('aria-label','目前模式：Codex')");
  await measured.apply(s);
  assert.equal(await measured.paint('data:image/png;base64,YQ==',{decoded:true}),false);
  assert.equal(await displayed(),cache);
  await client.evaluate(`(()=>{
    const decode=Image.prototype.decode;
    Image.prototype.decode=function(){return new Promise((resolve,reject)=>{window.releaseWallpaperFrame=()=>decode.call(this).then(resolve,reject)})};
    window.restoreWallpaperDecode=()=>{Image.prototype.decode=decode};
  })()`);
  const promoting=measured.paint(replacement,{decoded:true});
  for(let i=0;i<40&&!await client.evaluate("typeof window.releaseWallpaperFrame==='function'");i++)await delay(25);
  assert.equal(await displayed(),cache);
  await client.evaluate('window.releaseWallpaperFrame();window.restoreWallpaperDecode()');
  assert.equal(await promoting,true);
  assert.equal(await displayed(),replacement);
  await host.restoreAll({fallbackToken:documentToken});
  assert.equal(await displayed(),replacement);
  assert.equal(await host.showFallback(s,cache,documentToken),true);
  await host.restoreAll({fallbackToken:documentToken});
  assert.equal(await displayed(),undefined);
  await host.apply(s);await host.paint(cache,{decoded:true});
  const runSample=async work=>{calls=0;const start=performance.now();await work();return {calls,ms:performance.now()-start}};
  const startupInit=await runSample(async()=>{const sample=await measured.initialize(false);assert.equal(sample.structure.mode,'codex');assert.equal(sample.viewport.cssWidth,800)});
  assert.equal(startupInit.calls,1);
  const startupProof=await runSample(async()=>{assert.equal((await measured.confirmApplied(s)).imageConfirmed,true)});
  assert.equal(startupProof.calls,1);
  await assert.rejects(()=>measured.initialize(false,{expectedDocumentToken:'stale document'}),{code:'LAYOUT_CHANGED'});
  await assert.rejects(()=>measured.synchronize(s,{includeDiagnostics:false,expectedDocumentToken:'stale document'}),{code:'LAYOUT_CHANGED'});
  const oldMaintenance=async()=>{await measured.inspect();await measured.viewport();await client.evaluate("!!document.getElementById('codex-wallpaper-layer')");calls++;await measured.apply(s);await measured.imageMetrics();await measured.confirmApplied(s)};
  const oldSamples=[],newSamples=[];
  for(let n=0;n<15;n++){oldSamples.push(await runSample(oldMaintenance));newSamples.push(await runSample(()=>measured.synchronize(s)))}
  assert.equal(oldSamples[0].calls,7);assert.equal(newSamples[0].calls,1);
  let sync=await measured.synchronize(s);assert.equal(sync.proof.imageConfirmed,true);assert.equal(sync.viewport.cssWidth,800);assert.ok(sync.metrics.loads>0);
  const lean=await measured.synchronize(s,{includeDiagnostics:false});
  assert.equal(Object.hasOwn(lean.structure,'buttonCount'),false);assert.deepEqual(lean.proof,sync.proof);
  assert.deepEqual(await inspect(),after);
  await client.evaluate(`document.querySelector('button[aria-label]').setAttribute('aria-label','目前模式：ChatGPT');document.getElementById('codex-wallpaper-materials').textContent='broken'`);
  sync=await measured.synchronize(s,{includeDiagnostics:false});assert.equal(sync.structure.mode,'chatgpt');assert.equal(sync.proof.stylesConfirmed,true);assert.deepEqual(await inspect(),after);
  await client.evaluate(`document.querySelector('button[aria-label]').setAttribute('aria-label','unknown');document.getElementById('codex-wallpaper-materials').textContent='sentinel'`);
  await assert.rejects(()=>measured.synchronize(s,{includeDiagnostics:false}),e=>e.code==='HOST_SHELL_PENDING');assert.equal(await client.evaluate(`document.getElementById('codex-wallpaper-materials').textContent`),'sentinel');
  await client.evaluate(`document.querySelector('button[aria-label]').setAttribute('aria-label','目前模式：Codex');document.getElementById('codex-wallpaper-materials').dataset.owner='foreign'`);
  await assert.rejects(()=>measured.synchronize(s));assert.equal(await client.evaluate(`document.getElementById('codex-wallpaper-materials').textContent`),'sentinel');
  await client.evaluate(`document.getElementById('codex-wallpaper-materials').dataset.owner='codex-wallpaper'`);
  await measured.synchronize(s);await measured.synchronize({...s,enabled:false});assert.deepEqual(await inspect(),before);assert.equal(await client.evaluate(`!!document.getElementById('codex-wallpaper-layer')`),false);
  const median=values=>values.map(v=>v.ms).sort((a,b)=>a-b)[Math.floor(values.length/2)];
  console.log(JSON.stringify({maintenance:{oldCalls:oldSamples[0].calls,newCalls:newSamples[0].calls,oldMedianMs:median(oldSamples),newMedianMs:median(newSamples)},startup:{initialize:startupInit.calls,confirm:startupProof.calls},modeSwitch:true,foreignOwnerRejected:true,invalidLayoutUnmodified:true}));
  await host.restoreAll();assert.equal(await client.evaluate("getComputedStyle(document.querySelector('.sidebar-navigation')).backgroundColor"),'rgba(24, 24, 24, 0.65)');assert.deepEqual(await inspect(),before);assert.equal(await client.evaluate('document.querySelector("textarea").value'),'unsent fixture');
  const root=path.resolve('.state/controller-native-'+Date.now()),paths={data:path.join(root,'data'),runtime:path.join(root,'runtime')},directory=path.join(root,'video');await fs.mkdir(directory,{recursive:true});await fs.copyFile('test/wallpaper/fixtures/motion.webm',path.join(directory,'motion.webm'));await fs.writeFile(path.join(directory,'project.json'),JSON.stringify({type:'video',file:'motion.webm'}));const entry={id:'fixture:video',kind:'video',capability:'supported',directory,mediaPath:path.join(directory,'motion.webm')},store=createStore(paths.data),saved=defaults();saved.wallpaper.selectedId=entry.id;saved.playback.width=640;saved.playback.height=480;saved.performance.rendererMode='pool';saved.performance.resolutionMode='manual';await store.save(saved);service=createRendererService({paths});await service.configure(saved.performance);let visible=true;
  controller=new WallpaperController({store,library:{get:id=>id===entry.id?entry:null},host,prepareRenderer:(entry,playback,options)=>service.prepare(entry,playback,options),windowVisible:()=>visible});await controller.start();assert.equal(controller.error,null);await delay(1400);assert.equal((await host.confirmApplied(saved)).imageConfirmed,true);const loads=await host.imageMetrics();assert.ok(loads.loads>2);assert.equal(service.snapshot().healthy,true);
  await controller.patch({performance:{qualityMode:'low'}});assert.equal(controller.active.status.quality.jpeg,92);assert.equal(controller.settings.performance.qualityMode,'fixed');assert.equal((await host.confirmApplied(controller.settings)).imageConfirmed,true);
  const originalLease=controller.active;
  const waitForLeaseState=async state=>{
    const end=Date.now()+3000;
    while(controller.active?.status.state!==state&&Date.now()<end)await delay(50);
    assert.equal(controller.active?.status.state,state);
  };
  // React can retain a visible-size editor under an inactive page marker.
  await client.evaluate(`(()=>{
    const page=document.createElement('div');page.id='inactive-fixture';
    page.setAttribute('data-app-shell-active-page','false');
    page.append(document.createElement('textarea'));
    document.querySelector('[data-app-shell-frame]').append(page);
  })()`);
  assert.equal((await controller.refreshHost()).structure.editorCount,1);
  await client.evaluate(`(()=>{
    document.getElementById('inactive-fixture').remove();
    document.querySelector('[data-composer-body]').setAttribute('inert','');
    const card=document.createElement('div');card.id='request-fixture';
    card.setAttribute('data-codex-composer-request-navigation','');
    card.innerHTML='<div data-request-input-other-row><div data-rich-text-layout><div role="textbox" contenteditable="true">fixture</div></div></div>';
    document.querySelector('main').append(card);
  })()`);
  await assert.rejects(controller.refreshHost(),{code:'HOST_SHELL_PENDING'});
  await waitForLeaseState('paused');
  await delay(200);
  const held=(await host.imageMetrics()).loads;
  await delay(300);
  assert.equal((await host.imageMetrics()).loads,held);
  assert.equal(controller.active,originalLease);
  await client.evaluate(`document.getElementById('request-fixture').remove();document.querySelector('[data-composer-body]').removeAttribute('inert')`);
  assert.equal((await controller.refreshHost()).proof.stylesConfirmed,true);
  await waitForLeaseState('ready');
  assert.equal(controller.active,originalLease);
  const resumeDeadline=Date.now()+3000;
  while((await host.imageMetrics()).loads<=held&&Date.now()<resumeDeadline)await delay(50);
  assert.ok((await host.imageMetrics()).loads>held);
  assert.equal(await client.evaluate('document.querySelector("textarea").value'),'unsent fixture');
  await client.evaluate(`document.getElementById('codex-wallpaper-layer').remove()`);
  const repaired=await controller.refreshHost();assert.equal(repaired.proof.imageConfirmed,true);assert.equal(controller.active,originalLease);
  await client.evaluate(`document.getElementById('codex-wallpaper-image').remove()`);
  assert.equal((await controller.refreshHost()).proof.imageConfirmed,true);assert.equal(controller.active,originalLease);
  const waitState=async state=>{const end=Date.now()+3000;while(controller.active.status.state!==state&&Date.now()<end)await delay(50);assert.equal(controller.active.status.state,state)};visible=false;await waitState('paused');visible=true;await waitState('ready');await controller.patch({performance:{resolutionMode:'window'}});controller.setViewport({cssWidth:640,cssHeight:360,dpr:1.25,visible:true});await controller.whenIdle();assert.deepEqual([controller.renderSize.width,controller.renderSize.height],[800,450]);assert.deepEqual([(await store.load()).playback.width,(await store.load()).playback.height],[640,480]);assert.equal(controller.dirty,false);await controller.close();controller=null;await service.close();service=null;assert.equal(await client.evaluate(`!!document.getElementById('codex-wallpaper-layer')`),false);assert.deepEqual(await inspect(),before);assert.equal(await client.evaluate('document.querySelector("textarea").value'),'unsent fixture');console.log(JSON.stringify({pass:true,regions:Object.keys(MATERIAL_REGIONS),nativeTextAndGeometryPreserved:true,panCoversFrame:true,restoration:true,pooledControllerDecoded:true,hiddenPauseResume:true,physicalResizeWithoutPreferenceWrite:true,ownShutdownPreservesReceiver:true}));
 }finally{await controller?.close();await service?.close();await engine.close();await library.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
