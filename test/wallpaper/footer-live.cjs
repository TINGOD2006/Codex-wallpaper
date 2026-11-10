// Computed-style regression on an owned Edge fixture, without chat content.
const assert=require('node:assert/strict');
const {SceneEngine}=require('../../src/scene-engine.cjs'),{defaults}=require('../../src/wallpaper/schema.cjs'),{buildWallpaperStyles}=require('../../src/wallpaper/styles.cjs');
(async()=>{
 const engine=new SceneEngine({entry:{kind:'image',directory:require('node:path').resolve('assets'),mediaPath:require('node:path').resolve('assets/miku-background.png'),capability:'supported'},...defaults().playback,width:800,height:600});
 try{
  await engine.start();await engine.pause();const client=engine.client,frame=(await client.send('Page.getFrameTree')).frameTree.frame.id;
  await client.send('Page.setDocumentContent',{frameId:frame,html:`<!doctype html><style>body{margin:0}.surface{background:rgb(24,24,24)}.fade{background-image:linear-gradient(black,transparent)}[data-composer-surface-variant]{background:rgb(54,54,54);width:600px;height:100px}button{background:rgb(24,24,24)}</style><main data-app-shell-main-surface="default"><div data-app-action-timeline-scroll><div id="modern" class="background-uNUrfY surface-nr8PSS pointer-events-none absolute z-0 surface"></div><div id="fade" class="background-uNUrfY fade-AcMqqj pointer-events-none absolute z-0 fade"></div><div id="legacy" class="_background_18hic_a _surface_18hic_b pointer-events-none absolute z-0 surface"></div><div data-thread-scroll-footer="true"><div data-composer-surface-variant="default"><textarea>owned unsent fixture</textarea></div></div><button class="pointer-events-none">control</button><div id="unrelated" class="surface">unrelated</div></div></main>`});
  await client.evaluate(`document.querySelector('main').setAttribute('data-fixture','');document.body.innerHTML='<div data-app-shell-active-page="true">'+document.body.innerHTML+'</div>'`);
  const inspect=()=>client.evaluate(`(()=>{const style=id=>{const s=getComputedStyle(document.getElementById(id));return [s.backgroundColor,s.backgroundImage]};const c=document.querySelector('[data-composer-surface-variant]'),r=c.getBoundingClientRect();return {modern:style('modern'),fade:style('fade'),legacy:style('legacy'),composer:[getComputedStyle(c).backgroundColor,r.width,r.height],control:getComputedStyle(document.querySelector('button')).backgroundColor,unrelated:style('unrelated'),input:document.querySelector('textarea').value}})()`);
  const before=await inspect(),css=buildWallpaperStyles(defaults(),{kind:'codex'}).background;
  await client.evaluate(`const style=document.createElement('style');style.id='fixture-wallpaper';style.textContent=${JSON.stringify(css)};document.head.append(style)`);
  const after=await inspect();for(const key of ['modern','fade','legacy'])assert.deepEqual(after[key],['rgba(0, 0, 0, 0)','none']);for(const key of ['composer','control','unrelated','input'])assert.deepEqual(after[key],before[key]);
  await client.evaluate(`document.getElementById('fixture-wallpaper').remove()`);assert.deepEqual(await inspect(),before);
  console.log(JSON.stringify({pass:true,modernAndLegacyFooterCleared:true,composerAndControlsPreserved:true,restoration:true}));
 }finally{await engine.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
