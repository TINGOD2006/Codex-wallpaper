const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {prepareRenderer}=require('../../src/wallpaper/renderer.cjs');const {defaults}=require('../../src/wallpaper/schema.cjs');
test('an already cancelled selection cannot prepare a wallpaper renderer',async()=>{
  const entry={kind:'image',capability:'supported',mediaPath:path.resolve(__dirname,'../../assets/miku-background.png')};
  await assert.rejects(()=>prepareRenderer(entry,defaults().playback,{signal:AbortSignal.abort()}),/cancel/i);
});
