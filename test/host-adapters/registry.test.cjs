const {test}=require('node:test'),assert=require('node:assert/strict');
const {probeAdapter}=require('../../src/host-adapters/registry.cjs');
const shell={rootViewportCount:0,activeMainSurfaceCount:1,frameCount:1,composerBodyCount:1,editorCount:1,composerEditorCount:1,auxiliaryEditorCount:0,mode:'codex',regions:{chat:1,sidebar:1,composer:1,titlebar:1,panels:0,overlays:0}};
const host={id:'codex-desktop',kind:'codex-desktop',appVersion:'99.1.2.3'};
test('new versions pass the same structural contract and ambiguous required surfaces fail',()=>{
 const result=probeAdapter({host,structure:shell});assert.equal(result.ok,true);assert.equal(result.compatibility,'structural');
 const bad=probeAdapter({host,structure:{...shell,frameCount:2}});assert.equal(bad.ok,false);assert.ok(bad.requiredChecks.some(c=>c.id==='unique-frame'&&!c.passed));
 for(const patch of [{composerEditorCount:2},{editorCount:3},{mode:null}])assert.equal(probeAdapter({host,structure:{...shell,...patch}}).ok,false);
});
test('auxiliary editors are identified structurally and foreign hosts are not guessed',()=>{
 assert.equal(probeAdapter({host,structure:{...shell,editorCount:2,auxiliaryEditorCount:1}}).ok,true);
 assert.equal(probeAdapter({host,structure:{...shell,editorCount:2}}).ok,false);
 assert.equal(probeAdapter({host:{...host,kind:'chatgpt-native'},structure:shell}).ok,false);
});
test('native request-card editors do not invalidate the composer contract and unknown editors still fail',()=>{
 assert.equal(probeAdapter({host,structure:{...shell,editorCount:2,requestEditorCount:1}}).ok,true);
 assert.equal(probeAdapter({host,structure:{...shell,editorCount:3,auxiliaryEditorCount:1,requestEditorCount:1}}).ok,true);
 for(const extra of [{editorCount:3,requestEditorCount:1},{editorCount:2,requestEditorCount:0},{editorCount:3,composerEditorCount:2,requestEditorCount:1}])assert.equal(probeAdapter({host,structure:{...shell,...extra}}).ok,false);
});
