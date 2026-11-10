const {test}=require('node:test'),assert=require('node:assert/strict');
const {defaults,mergeSettings}=require('../../src/wallpaper/schema.cjs');
const {buildWallpaperStyles}=require('../../src/wallpaper/styles.cjs');
const {detectLayout}=require('../../src/adapters.cjs');
const {WallpaperHost}=require('../../src/wallpaper/host.cjs');
const layout=detectLayout({rootViewportCount:0,activeMainSurfaceCount:1,frameCount:1,composerBodyCount:1,editorCount:1,mode:'codex'},'26.1023.6123.0');
test('wallpaper uses native surfaces without changing the app palette or inactive materials',()=>{
  const styles=buildWallpaperStyles(defaults(),layout);assert.equal(styles.colors,'');assert.equal(styles.materials,'');
  assert.ok(styles.background.includes('var(--app-color-background-surface'));
  assert.equal(styles.background.includes('--app-color-text-foreground:'),false);
});
test('material transparency and image filters cannot fade or blur chat text',()=>{
  const settings=mergeSettings(defaults(),{materials:{sidebar:{enabled:true,alpha:.4,blur:12}},reading:{blur:8,opacity:.5}});
  const styles=buildWallpaperStyles(settings,layout);
  assert.match(styles.materials,/backdrop-filter:\s*blur\(12px\)/);
  assert.doesNotMatch(styles.materials,/(?:^|[;{])\s*(?:opacity|filter|transform)\s*:/);
  assert.match(styles.background,/#codex-wallpaper-image[^}]*filter:/);
});
test('custom colors can be disabled independently and never override semantic diff colors',()=>{
  const settings=mergeSettings(defaults(),{colors:{enabled:true}}),styles=buildWallpaperStyles(settings,layout);
  assert.match(styles.colors,/--app-color-text-foreground:/);assert.doesNotMatch(styles.colors,/decoration-deleted|decoration-added|text-error/);
  assert.equal(buildWallpaperStyles(mergeSettings(settings,{colors:{enabled:false}}),layout).colors,'');
  assert.throws(()=>buildWallpaperStyles(settings,{kind:'unsupported'}));
});
test('host rejects a stale document rather than claiming its styles were committed',async()=>{
  let inspect=true;const host=new WallpaperHost({evaluate:async()=>{if(inspect){inspect=false;return {rootViewportCount:0,activeMainSurfaceCount:1,frameCount:1,composerBodyCount:1,editorCount:1,mode:'codex',documentToken:'old-document'}}return false}},'26.1023.6123.0');
  await assert.rejects(()=>host.apply(defaults()),e=>e.code==='LAYOUT_CHANGED');
});

test('native button and classified editor changes preserve wallpaper while unsafe structure changes are rejected',async()=>{
  const vm=require('node:vm'),{structureExpression}=require('../../src/adapters.cjs');
  const initial={rootViewportCount:0,activeMainSurfaceCount:1,frameCount:1,composerBodyCount:1,editorCount:1,composerEditorCount:1,auxiliaryEditorCount:0,requestEditorCount:0,buttonCount:100,mode:'codex',regions:{overlays:0},documentToken:'123'};
  async function applyChanged(patch,timeOrigin=123){
    const nodes=new Map(),current={...initial,...patch};delete current.documentToken;
    const document={querySelectorAll:selector=>nodes.has(selector.slice(1))?[nodes.get(selector.slice(1))]:[],getElementById:id=>nodes.get(id),createElement:()=>({dataset:{},remove(){nodes.delete(this.id)}}),head:{append(node){nodes.set(node.id,node)}}};
    const host=new WallpaperHost({evaluate:expression=>vm.runInNewContext(expression.replace(structureExpression,JSON.stringify(current)),{document,performance:{timeOrigin}})},'26.1027.3384.0');
    host.inspect=async()=>initial;
    return host.apply(defaults());
  }
  await applyChanged({buttonCount:105,editorCount:2,requestEditorCount:1,regions:{overlays:1}});
  for(const patch of [{editorCount:2},{frameCount:2},{composerEditorCount:2,editorCount:2},{mode:'chatgpt'}])await assert.rejects(()=>applyChanged(patch),e=>e.code==='LAYOUT_CHANGED');
  await assert.rejects(()=>applyChanged({},456),e=>e.code==='LAYOUT_CHANGED');
});
