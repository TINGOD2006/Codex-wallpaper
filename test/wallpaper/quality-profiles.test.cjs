const {test}=require('node:test'),assert=require('node:assert/strict');
const {WallpaperController}=require('../../src/wallpaper/controller.cjs');
const {defaults,mergeSettings}=require('../../src/wallpaper/schema.cjs');
test('legacy quality preferences normalize to original size and full effects without changing frame-rate preferences',()=>{
 const c=new WallpaperController({});c.latestViewport={cssWidth:1920,cssHeight:1020,dpr:1,visible:true};
 for(const mode of ['fixed','balanced','low']){
  const settings=mergeSettings(defaults(),{performance:{qualityMode:mode}}),result=c.renderPlayback(settings);
  assert.equal(settings.performance.qualityMode,'fixed');assert.equal(result.size.width,1920);assert.equal(result.playback.captureQuality,92);assert.equal(result.playback.qualityMode,'fixed');assert.equal(result.playback.renderFps,30);assert.equal(result.playback.displayFps,30);
  assert.equal(settings.playback.width,1920);assert.equal(settings.playback.height,1080);
 }
 assert.throws(()=>mergeSettings(defaults(),{performance:{qualityMode:'unknown'}}));
});
