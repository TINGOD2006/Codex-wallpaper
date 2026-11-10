const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildThemeCss}=require('../src/theme.cjs');
const {detectLayout}=require('../src/adapters.cjs');
const config=require('../config.json');
const image={mime:'image/png',dataUri:'data:image/png;base64,aGVsbG8='};
const layout=detectLayout({rootViewportCount:1,loginSurfaceCount:1,editorCount:0,buttonCount:3},'26.1021.3705.0');
test('builds scoped image and coordinated surface colors without changing layout',()=>{
  const css=buildThemeCss(config,image,layout);
  assert.ok(css.includes(image.dataUri));assert.ok(css.includes(config.palette.panel));
  assert.ok(css.includes('--app-color-background-elevated-primary'));
  assert.ok(!/(?:^|[;{])\s*(?:display|position|width|height|z-index|pointer-events)\s*:/m.test(css));
  assert.ok(!css.includes('--app-color-decoration-deleted'));
});
test('rejects unsupported layouts and CSS injection through settings or image payload',()=>{
  assert.throws(()=>buildThemeCss(config,image,{kind:'unsupported'}));
  assert.throws(()=>buildThemeCss({...config,palette:{...config.palette,accent:'red;display:none'}},image,layout));
  assert.throws(()=>buildThemeCss(config,{mime:'image/png',dataUri:"data:image/png;base64,x');body{display:none}"},layout));
  assert.throws(()=>buildThemeCss({...config,positionX:NaN},image,layout));
});
