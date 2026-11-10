const {test}=require('node:test'),assert=require('node:assert/strict');
const {rendererIsHealthy}=require('../../src/companion/runtime-runner.cjs'),{defaults}=require('../../src/wallpaper/schema.cjs');
test('expected suspended renderer release is healthy but active or broken leases cannot be hidden',()=>{
 const s=defaults();s.enabled=true;s.wallpaper.enabled=true;s.wallpaper.selectedId='fixture';s.playback.pauseWhenHidden=true;
 assert.equal(rendererIsHealthy(s,{state:'paused'},null,false),true);
 assert.equal(rendererIsHealthy(s,{state:'paused'},null,true),false);
 assert.equal(rendererIsHealthy(s,{state:'error'},null,false),false);
 assert.equal(rendererIsHealthy(s,{state:'paused'},{invalid:'lost',status:{state:'paused'}},false),false);
 s.playback.paused=true;assert.equal(rendererIsHealthy(s,{state:'paused'},null,true),true);
 assert.equal(rendererIsHealthy(s,{state:'playing'},null,false),false);
});
