const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {SceneEngine}=require('../../src/scene-engine.cjs'),{defaults}=require('../../src/wallpaper/schema.cjs'),{createStore}=require('../../src/wallpaper/store.cjs');
const {WallpaperController}=require('../../src/wallpaper/controller.cjs'),{createLibrary}=require('../../src/wallpaper/library.cjs'),{createPresets}=require('../../src/wallpaper/presets.cjs'),{createCommandHandler}=require('../../src/wallpaper/commands.cjs');
const {mountWallpaperPanel}=require('../../src/wallpaper/panel-dom.js'),{delay}=require('../../src/control.cjs');
const {FULL_WINDOW_MATERIALS}=require('../../src/wallpaper/styles.cjs');
(async()=>{
 const dataRoot=await fs.mkdtemp(path.join(os.tmpdir(),'wallpaper-panel-live-')),store=createStore(dataRoot),library=createLibrary({roots:[],dataRoot});await library.scan();
 const image=library.get('builtin:miku'),engine=new SceneEngine({...defaults().playback,width:1000,height:740,entry:image});let controller,handler,clears=0;
 const rendering={controlsAvailable:true,healthy:true,backend:'pool',outputSize:{width:1920,height:1020},decodedFps:29.8,cache:{effectiveCacheEnabled:true,usedBytes:4036154,limitBytes:536870912,readHits:2}};
 try{
  await engine.start();await engine.pause();const c=engine.client;const frame=(await c.send('Page.getFrameTree')).frameTree.frame.id;
  await c.send('Page.setDocumentContent',{frameId:frame,html:'<!doctype html><html><head><style>:root{color-scheme:dark;--app-color-background-surface:#181818;--app-color-text-foreground:#eee}body{margin:0}#outside{position:absolute;left:8px;top:200px;width:200px;height:80px}</style></head><body><textarea id="outside" aria-label="自己的測試輸入"></textarea></body></html>'});
  const host={apply:async()=>{},restoreAll:async()=>{},clearBackground:async()=>{},paint:async()=>{},validateImage:async()=>{}};
  controller=new WallpaperController({store,library,host,prepareRenderer:async()=>({status:{state:'ready'},frame:async()=>'',setPlayback:async()=>{},pause:async()=>{},resume:async()=>{},close:async()=>{}})});await controller.start();
  const presets=createPresets({dataRoot,store,library}),actions=[];handler=createCommandHandler({sessionId:'fixture',panelId:'fixture-panel',controller,library,presets,chooseFile:async()=>({cancelled:true}),clearCache:async()=>{clears++}});
  await c.send('Runtime.enable');await c.send('Runtime.addBinding',{name:'fixtureWallpaper'});c.on('notification',event=>{if(event.method==='Runtime.bindingCalled'&&event.params.name==='fixtureWallpaper'){const cmd=JSON.parse(event.params.payload);actions.push(cmd.action);handler.dispatch(cmd).then(reply=>{if(reply.state)reply.state.rendering=rendering;return c.evaluate(`window.__codexWallpaperPanel.receive(${JSON.stringify(reply)})`)}).catch(e=>console.error(e.message))}});
  const css=await fs.readFile(path.resolve('src/wallpaper/panel.css'),'utf8');await c.evaluate(`(${mountWallpaperPanel.toString()})(${JSON.stringify({sessionId:'fixture',panelId:'fixture-panel',binding:'fixtureWallpaper',css,fullWindowMaterials:FULL_WINDOW_MATERIALS})})`);
  const state={...controller.snapshot(),rendering,cards:[...library.cards(controller.settings),{id:'bad:title',title:'<img src=x onerror="window.pwned=true">',kind:'web',contentRating:'unknown',capability:'unsupported'}],presets:await presets.list()};
  await c.evaluate(`__codexWallpaperPanel.update(${JSON.stringify(state)});document.getElementById('codex-wallpaper-button').click()`);
  const refreshResult=await c.evaluate(`(()=>{
    const state=${JSON.stringify(state)},panel=window.__codexWallpaperPanel;
    panel.update(state);
    const observer=new MutationObserver(()=>{});
    observer.observe(document.getElementById('codex-wallpaper-panel'),{subtree:true,attributes:true,childList:true});
    try{
      panel.update(structuredClone(state));
      const unchanged=observer.takeRecords().length;
      panel.update({...state,rendering:{...state.rendering,decodedFps:23.5}});
      const fpsUpdated=document.getElementById('cw-section-playback').textContent.includes('畫面 23.5 FPS');
      return {unchanged,fpsUpdated};
    }finally{observer.disconnect();panel.update(state)}
  })()`);
  assert.deepEqual(refreshResult,{unchanged:0,fpsUpdated:true});
  assert.equal(await c.evaluate(`document.querySelectorAll('#codex-wallpaper-panel [role=tab]').length`),5);assert.equal(await c.evaluate('!!window.pwned'),false);
  for(const width of [1536,768,375]){await c.send('Emulation.setDeviceMetricsOverride',{width,height:720,deviceScaleFactor:1,mobile:false});const rect=await c.evaluate(`(()=>{const r=document.getElementById('codex-wallpaper-panel').getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,bottom:r.bottom}})()`);assert.ok(rect.left>=0&&rect.right<=width&&rect.bottom<=720);if(width>450)assert.equal(rect.width,420)}
  await c.send('Emulation.setDeviceMetricsOverride',{width:1000,height:740,deviceScaleFactor:1,mobile:false});
  await c.evaluate(`(()=>{document.getElementById('cw-tab-reading').click();const i=document.querySelector('[data-setting="reading.scrim"]');i.focus();i.value='.62';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);await delay(750);
  assert.equal((await store.load()).reading.scrim,.62);assert.equal(await c.evaluate(`document.activeElement.dataset.setting`),'reading.scrim');
  await c.evaluate(`(()=>{document.getElementById('cw-tab-materials').click();const i=document.querySelector('[data-setting="materials.sidebar.mode"]');i.closest('details').querySelector('summary').click();i.value='inherit';i.dispatchEvent(new Event('change'))})()`);await delay(250);assert.equal((await store.load()).materials.sidebar.enabled,true);assert.equal((await store.load()).materials.sidebar.inherit,true);
  await c.evaluate(`[...document.querySelectorAll('#cw-section-materials button')].find(b=>b.textContent==='套用全視窗材質').click()`);await delay(300);for(const group of Object.keys(FULL_WINDOW_MATERIALS))assert.equal((await store.load()).materials[group].enabled,true);assert.equal((await store.load()).materials.sidebar.inherit,false);
  await c.evaluate(`document.getElementById('cw-tab-playback').click();document.querySelector('[data-setting="playback.paused"]').click()`);await delay(250);assert.equal((await store.load()).playback.paused,true);
  const sizeMenu='[data-setting="performance.resolutionMode"]';
  assert.deepEqual(await c.evaluate(`[...document.querySelector('${sizeMenu}').options].map(option=>option.value)`),['window','360P','480P','720P','1080P','2K','4K']);
  await c.evaluate(`(()=>{const i=document.querySelector('${sizeMenu}');i.closest('details').querySelector('summary').click();i.value='4K';i.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await delay(700);
  const output=await store.load();assert.equal(output.performance.resolutionMode,'manual');assert.deepEqual([output.playback.width,output.playback.height],[3840,2160]);
  assert.equal(await c.evaluate(`document.querySelector('[data-setting="playback.width"]')===null`),true);
  await c.evaluate(`(()=>{const i=document.querySelector('[data-setting="performance.rendererMode"]');i.focus();i.value='isolated';i.dispatchEvent(new Event('change',{bubbles:true}))})()`);await delay(700);assert.equal((await store.load()).performance.rendererMode,'isolated');assert.equal(await c.evaluate(`document.activeElement.dataset.setting`),'performance.rendererMode');
  await c.evaluate(`document.querySelector('[data-setting="performance.cacheEnabled"]').click();[...document.querySelectorAll('#cw-section-playback button')].find(b=>b.textContent==='清理貼圖快取').click()`);await delay(700);assert.equal(clears,1);assert.equal((await store.load()).performance.cacheEnabled,false);assert.match(await c.evaluate(`document.getElementById('cw-section-playback').textContent`),/1920 × 1020/);
  await c.evaluate(`document.getElementById('cw-tab-playback').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}))`);assert.equal(await c.evaluate(`document.activeElement.id`),'cw-tab-library');
  await c.evaluate(`document.getElementById('cw-tab-presets').click();document.querySelector('[aria-label="方案名稱"]').value='自己的測試';[...document.querySelectorAll('#cw-section-presets button')].find(b=>b.textContent==='另存目前設定').click()`);await delay(350);assert.ok((await presets.list()).some(p=>p.name==='自己的測試'));
  await c.evaluate(`document.getElementById('cw-tab-library').click();document.querySelector('#cw-section-library summary').click();[...document.querySelectorAll('#cw-section-library button')].find(b=>b.textContent==='匯入圖片／影片').click()`);await delay(250);assert.equal((await c.evaluate(`document.querySelector('#codex-wallpaper-panel .cw-status').textContent`)),'已取消');
  await c.evaluate(`document.getElementById('outside').focus();document.getElementById('outside').value='unsent fixture';document.getElementById('outside').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);assert.equal(await c.evaluate(`document.getElementById('codex-wallpaper-panel').hidden`),false);
  await c.evaluate(`document.getElementById('cw-tab-library').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);assert.equal(await c.evaluate(`document.getElementById('codex-wallpaper-panel').hidden`),true);assert.equal(await c.evaluate(`document.getElementById('outside').value`),'unsent fixture');
  await c.evaluate(`document.getElementById('codex-wallpaper-button').click();document.getElementById('cw-tab-presets').click();document.querySelector('[aria-label="方案名稱"]').value='';[...document.querySelectorAll('#cw-section-presets button')].find(b=>b.textContent==='另存目前設定').click()`);await delay(250);assert.match(await c.evaluate(`document.querySelector('#codex-wallpaper-panel [role=alert]').textContent`),/名稱/);
  await c.evaluate(`document.getElementById('codex-wallpaper-button').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);assert.equal(await c.evaluate(`document.getElementById('codex-wallpaper-panel').hidden`),true);
  console.log(JSON.stringify({pass:true,viewportWidths:[1536,768,375],tabs:5,actions:[...new Set(actions)],performanceControls:true,cacheClears:clears,preservedOutsideInput:true,focusPreserved:true,maliciousTitleInert:true,pickerCancelled:true,launcherEscape:true}));
 }finally{handler?.close();await controller?.close();await engine.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
