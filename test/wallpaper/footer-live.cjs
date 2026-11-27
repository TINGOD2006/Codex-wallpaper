// Computed-style regression on an owned Edge fixture, without chat content.
const assert=require('node:assert/strict');
const {SceneEngine}=require('../../src/scene-engine.cjs'),{defaults}=require('../../src/wallpaper/schema.cjs'),{buildWallpaperStyles}=require('../../src/wallpaper/styles.cjs');
const {WallpaperHost}=require('../../src/wallpaper/host.cjs');
const cachedFrame='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=';
(async()=>{
 const engine=new SceneEngine({entry:{kind:'image',directory:require('node:path').resolve('assets'),mediaPath:require('node:path').resolve('assets/miku-background.png'),capability:'supported'},...defaults().playback,width:800,height:600});
 try{
  await engine.start();await engine.pause();const client=engine.client,frame=(await client.send('Page.getFrameTree')).frameTree.frame.id;
  await client.send('Page.setDocumentContent',{frameId:frame,html:`<!doctype html><style>body{margin:0}.surface{background:rgb(24,24,24)}.fade{background-image:linear-gradient(black,transparent)}[data-composer-surface-variant]{background:rgb(54,54,54);width:600px;height:100px}button{background:rgb(24,24,24)}</style><main data-app-shell-main-surface="default"><div data-app-action-timeline-scroll><div id="modern" class="background-uNUrfY surface-nr8PSS pointer-events-none absolute z-0 surface"></div><div id="fade" class="background-uNUrfY fade-AcMqqj pointer-events-none absolute z-0 fade"></div><div id="legacy" class="_background_18hic_a _surface_18hic_b pointer-events-none absolute z-0 surface"></div><div data-thread-scroll-footer="true"><div data-composer-surface-variant="default"><textarea>owned unsent fixture</textarea></div></div><button class="pointer-events-none">control</button><div id="unrelated" class="surface">unrelated</div></div></main>`});
  await client.evaluate(`(()=>{
   const main=document.querySelector('main');
   main.id='fixture-chat';main.classList.add('surface');
   const frame=document.createElement('div');frame.dataset.appShellFrame='true';
   const sidebar=document.createElement('aside');sidebar.className='app-shell-left-panel';
   sidebar.innerHTML='<button aria-haspopup="menu" aria-label="Mode: Codex">Codex</button>';
   const page=document.createElement('div');page.id='fixture-active-page';page.dataset.appShellActivePage='true';
   const workspace=document.createElement('div');workspace.setAttribute('data-app-shell-workspace','');workspace.style.position='relative';
   const backing=document.createElement('div');backing.id='fixture-backing';backing.className='surface fade';
   backing.setAttribute('data-app-shell-surface-backing','');backing.setAttribute('aria-hidden','true');
   backing.style.cssText='position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 0 1px white';
   const unrelated=backing.cloneNode();unrelated.id='outside-workspace-backing';
   const accessible=backing.cloneNode();accessible.id='accessible-backing';accessible.removeAttribute('aria-hidden');
   page.append(main);workspace.append(backing,sidebar,page,accessible);frame.append(workspace,unrelated);document.body.append(frame);
   main.querySelector('[data-composer-surface-variant]').setAttribute('data-composer-body','');
  })()`);
  // Codex 26.1111 paints the bottom strip on pseudo-elements of the native
  // footer. An unrelated footer elsewhere and the composer must retain theirs.
  await client.evaluate(`(()=>{
   const timeline=document.querySelector('[data-app-action-timeline-scroll]');
   timeline.classList.add('thread-scroll-container');
   const style=document.createElement('style');
   style.textContent='.footer-fixture::before{content:"";background-image:linear-gradient(transparent,rgb(24,24,24))}.footer-fixture::after{content:"";background-color:rgb(24,24,24)}';
   document.head.append(style);
   const footer=document.createElement('div');
   footer.id='native-footer';footer.className='footer-fixture pointer-events-none absolute inset-x-0 z-20 bottom-0';
   timeline.append(footer);
   footer.append(timeline.querySelector('[data-thread-scroll-footer]'));
   const unrelated=footer.cloneNode(false);unrelated.id='unrelated-footer';timeline.append(unrelated);
  })()`);
  const footerPaint=()=>client.evaluate(`(()=>{
   const inspect=id=>{const e=document.getElementById(id);return [getComputedStyle(e,'::before').backgroundImage,getComputedStyle(e,'::after').backgroundColor]};
   return {native:inspect('native-footer'),unrelated:inspect('unrelated-footer')};
  })()`);
  const inspect=()=>client.evaluate(`(()=>{const style=id=>{const s=getComputedStyle(document.getElementById(id));return [s.backgroundColor,s.backgroundImage]};const c=document.querySelector('[data-composer-surface-variant]'),r=c.getBoundingClientRect();return {modern:style('modern'),fade:style('fade'),legacy:style('legacy'),composer:[getComputedStyle(c).backgroundColor,r.width,r.height],control:getComputedStyle(document.querySelector('button')).backgroundColor,unrelated:style('unrelated'),input:document.querySelector('textarea').value}})()`);
  const backingStyles=()=>client.evaluate(`['fixture-backing','outside-workspace-backing','accessible-backing'].map(id=>{
    const style=getComputedStyle(document.getElementById(id));return [style.backgroundColor,style.backgroundImage,style.boxShadow];
  })`);
  const backingBefore=await backingStyles();
  assert.equal(backingBefore[0][0],'rgb(24, 24, 24)');
  assert.match(backingBefore[0][1],/linear-gradient/);
  const backingWithWallpaper=[['rgba(0, 0, 0, 0)','none',backingBefore[0][2]],...backingBefore.slice(1)];
  const before=await inspect(),paintBefore=await footerPaint(),css=buildWallpaperStyles(defaults(),{kind:'codex'}).background;
  assert.match(paintBefore.native[0],/linear-gradient/);
  assert.equal(paintBefore.native[1],'rgb(24, 24, 24)');
  await client.evaluate(`const style=document.createElement('style');style.id='fixture-wallpaper';style.textContent=${JSON.stringify(css)};document.head.append(style)`);
  const after=await inspect();for(const key of ['modern','fade','legacy'])assert.deepEqual(after[key],['rgba(0, 0, 0, 0)','none']);for(const key of ['composer','control','unrelated','input'])assert.deepEqual(after[key],before[key]);
  assert.deepEqual(await backingStyles(),backingWithWallpaper);
  const paintAfter=await footerPaint();
  assert.deepEqual(paintAfter.native,['none','rgba(0, 0, 0, 0)']);
  assert.deepEqual(paintAfter.unrelated,paintBefore.unrelated);

  // The current Codex layout places the active page inside main.
  await client.evaluate(`(()=>{
   const page=document.getElementById('fixture-active-page'),main=document.getElementById('fixture-chat');
   const frame=page.parentElement,timeline=main.querySelector('[data-app-action-timeline-scroll]');
   frame.append(main);page.style.display='contents';page.append(timeline);main.append(page);
   for(const id of ['inert-tab','inactive-tab','outside-frame']){
    const other=document.createElement('main');other.id=id;other.className='surface';other.dataset.appShellMainSurface='default';
    const marker=document.createElement('div');marker.dataset.appShellActivePage='true';marker.textContent='fixture';other.append(marker);
    if(id==='inert-tab')other.inert=true;
    if(id==='inactive-tab')other.dataset.appShellActivePage='false';
    (id==='outside-frame'?document.body:frame).append(other);
   }
  })()`);
  const host=new WallpaperHost(client,'26.1117.4957.0'),settings=defaults();
  const snapshot=await host.inspect();
  assert.equal(snapshot.activeMainSurfaceCount,1);
  assert.equal(snapshot.regions.chat,1);
  const tabColors=()=>client.evaluate(`['fixture-chat','inert-tab','inactive-tab','outside-frame'].map(id=>getComputedStyle(document.getElementById(id)).backgroundColor)`);
  const opaque='rgb(24, 24, 24)',transparent='rgba(0, 0, 0, 0)';
  assert.deepEqual(await tabColors(),[transparent,opaque,opaque,opaque]);
  await client.evaluate(`document.getElementById('fixture-wallpaper').remove()`);assert.deepEqual(await inspect(),before);
  assert.deepEqual(await footerPaint(),paintBefore);
  assert.deepEqual(await backingStyles(),backingBefore);
  assert.equal(await host.showFallback(settings,cachedFrame,snapshot.documentToken),true);
  assert.deepEqual(await tabColors(),[transparent,opaque,opaque,opaque]);
  assert.deepEqual(await backingStyles(),backingWithWallpaper);
  await host.apply(settings);
  assert.deepEqual((await host.synchronize(settings)).proof,{stylesConfirmed:true,imageConfirmed:true});
  assert.deepEqual(await backingStyles(),backingWithWallpaper);

  await host.restoreAll();
  assert.deepEqual(await backingStyles(),backingBefore);
  await client.evaluate(`(()=>{
   const main=document.getElementById('inert-tab');main.inert=false;
  })()`);
  assert.equal((await host.inspect()).activeMainSurfaceCount,2);
  assert.equal(await host.showFallback(settings,cachedFrame,snapshot.documentToken),false);
  await assert.rejects(host.apply(settings),{code:'ADAPTER_LAYOUT_MISMATCH'});
  assert.deepEqual(await tabColors(),[opaque,opaque,opaque,opaque]);
  console.log(JSON.stringify({pass:true,modernAndLegacyFooterCleared:true,composerAndControlsPreserved:true,activePageInsideMain:true,ambiguousMainRejected:true,nativeBackingCleared:true}));
 }finally{await engine.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
