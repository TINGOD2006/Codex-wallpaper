const {test}=require('node:test');
const assert=require('node:assert/strict');
const {detectLayout,structureExpression}=require('../src/adapters.cjs');
const version='26.1021.3705.0';
test('mode detection ignores retained hidden Codex/ChatGPT pages but rejects two visible modes',()=>{
 const vm=require('node:vm'),selector='.app-shell-left-panel button[aria-haspopup="menu"][aria-label]';
 const button=(mode,shown)=>({closest:()=>null,getBoundingClientRect:()=>({width:shown?100:0,height:shown?32:0}),checkVisibility:()=>shown,getAttribute:()=>`切換模式，目前模式：${mode}`});
 const read=buttons=>vm.runInNewContext(structureExpression,{document:{querySelectorAll:s=>s===selector?buttons:[]}}).mode;
 assert.equal(read([button('Codex',false),button('ChatGPT',true)]),'chatgpt');
 assert.equal(read([button('Codex',true),button('ChatGPT',false)]),'codex');
 assert.equal(read([button('Codex',true),button('ChatGPT',true)]),null);
 assert.equal(read([button('Codex',false)]),null);
});
const login={rootViewportCount:1,loginSurfaceCount:1,editorCount:0,buttonCount:3};
test('recognizes only the unambiguous measured login layout',()=>{
  assert.equal(detectLayout(login,version).kind,'login');
  assert.equal(detectLayout({...login,buttonCount:5},version).kind,'login');
  for(const patch of [{rootViewportCount:0},{rootViewportCount:2},{loginSurfaceCount:2},{editorCount:1},{buttonCount:0}])assert.equal(detectLayout({...login,...patch},version).kind,'unsupported');
  assert.equal(detectLayout(login,'99.0.0.0').kind,'unsupported');
});
test('does not guess a chat adapter from a textarea alone',()=>{
  assert.equal(detectLayout({...login,loginSurfaceCount:0,editorCount:1},version).kind,'unsupported');
  assert.ok(!/innerText|textContent|\.value\b/.test(structureExpression));
});
test('recognizes the measured authenticated Codex shell and rejects ambiguous surfaces',()=>{
  const shell={rootViewportCount:0,loginSurfaceCount:0,editorCount:1,buttonCount:41,activeMainSurfaceCount:1,frameCount:1,composerBodyCount:1,mode:'codex'};
  assert.equal(detectLayout(shell,version).kind,'codex');
  for(const patch of [{activeMainSurfaceCount:2},{frameCount:0},{composerBodyCount:0},{mode:null},{editorCount:2}])assert.equal(detectLayout({...shell,...patch},version).kind,'unsupported');
});
test('recognizes the measured ChatGPT shell without treating it as Codex',()=>{
  const shell={rootViewportCount:0,loginSurfaceCount:0,editorCount:1,buttonCount:30,activeMainSurfaceCount:1,frameCount:1,composerBodyCount:1,mode:'chatgpt'};
  assert.equal(detectLayout(shell,version).kind,'chatgpt');
});
test('recognizes updated desktop shells by structure with explicit version provenance',()=>{
  const shell={rootViewportCount:0,loginSurfaceCount:0,editorCount:1,buttonCount:30,activeMainSurfaceCount:1,frameCount:1,composerBodyCount:1,mode:'codex'};
  assert.equal(detectLayout(shell,'26.1023.6123.0').kind,'codex');
  assert.equal(detectLayout({...shell,activeMainSurfaceCount:2},'26.1023.6123.0').kind,'unsupported');
  assert.equal(detectLayout(shell,'26.1023.9999.0').kind,'codex');
  assert.equal(detectLayout(shell,'26.1023.9999.0').compatibility,'structural');
});
test('recognizes one measured native side editor but rejects unclassified or duplicate editors',()=>{
  const shell={rootViewportCount:0,editorCount:2,composerEditorCount:1,auxiliaryEditorCount:1,activeMainSurfaceCount:1,frameCount:1,composerBodyCount:1,mode:'chatgpt'};
  assert.equal(detectLayout(shell,'26.1023.6123.0').kind,'chatgpt');
  for(const patch of [{auxiliaryEditorCount:0},{composerEditorCount:2},{editorCount:3}])assert.equal(detectLayout({...shell,...patch},'26.1023.6123.0').kind,'unsupported');
});
test('recognizes the 6621 shell and compatible patches but rejects unknown editors',()=>{
  const shell={rootViewportCount:0,editorCount:1,composerEditorCount:1,auxiliaryEditorCount:0,activeMainSurfaceCount:1,frameCount:1,composerBodyCount:1,mode:'codex'};
  assert.equal(detectLayout(shell,'26.1023.6621.0').kind,'codex');
  assert.equal(detectLayout({...shell,editorCount:2,auxiliaryEditorCount:1},'26.1023.6621.0').kind,'codex');
  assert.equal(detectLayout({...shell,editorCount:2,auxiliaryEditorCount:0},'26.1023.6621.0').kind,'unsupported');
  assert.equal(detectLayout(shell,'26.1023.6622.0').kind,'codex');
});
