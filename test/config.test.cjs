const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {loadConfig,saveConfig,loadImage} = require('../src/config.cjs');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9e0AAAAASUVORK5CYII=', 'base64');
async function fixture(t) {
  const base = path.join(__dirname,'../.state/tests');
  await fs.mkdir(base,{recursive:true});
  const dir = await fs.mkdtemp(path.join(base,'config-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await fs.writeFile(path.join(dir,'background.png'),png);
  const config = {backgroundPath:'background.png',positionX:100,overlayOpacity:.64,palette:{surface:'#283946',panel:'#304653',text:'#eff5f7',muted:'#b7cbd2',accent:'#7cb8b6',selection:'#395d68'}};
  const file=path.join(dir,'config.json');
  await fs.writeFile(file,JSON.stringify(config));
  return {dir,file,config};
}
test('resolves a relative background path and reads PNG by content',async t=>{
  const {dir,file}=await fixture(t);
  const config=await loadConfig(file);
  assert.equal(config.backgroundPath,path.join(dir,'background.png'));
  const image=await loadImage(config.backgroundPath);
  assert.equal(image.mime,'image/png');
  assert.ok(image.dataUri.startsWith('data:image/png;base64,'));
});
test('rejects invalid patches without changing the saved settings',async t=>{
  const {file,config}=await fixture(t);
  for(const patch of [{overlayOpacity:1.1},{overlayOpacity:NaN},{positionX:-1},{palette:{accent:'red;display:none'}},{unexpected:true}]) {
    await assert.rejects(()=>saveConfig(file,patch));
    assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),config);
  }
});
test('rejects disguised or truncated images and files larger than 10 MiB',async t=>{
  const {dir}=await fixture(t);
  const bad=path.join(dir,'fake.png');
  await fs.writeFile(bad,'not an image');
  await assert.rejects(()=>loadImage(bad),/image|圖片/i);
  await fs.writeFile(bad,png.subarray(0,24));
  await assert.rejects(()=>loadImage(bad));
  await fs.writeFile(bad,Buffer.alloc(10*1024*1024+1));
  await assert.rejects(()=>loadImage(bad),/10 MiB/);
});
test('failed image update preserves config; valid palette patch merges and persists',async t=>{
  const {file,config}=await fixture(t);
  await assert.rejects(()=>saveConfig(file,{backgroundPath:'missing.png'}));
  assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),config);
  const saved=await saveConfig(file,{palette:{accent:'#a6d4d1'},overlayOpacity:.72});
  assert.equal(saved.palette.surface,config.palette.surface);
  assert.equal(saved.palette.accent,'#a6d4d1');
  assert.equal((await loadConfig(file)).overlayOpacity,.72);
});
test('rejects non-object JSON and dangerous property names',async t=>{
  const {file}=await fixture(t);
  await assert.rejects(()=>saveConfig(file,JSON.parse('{"__proto__":{"bad":true}}')));
  await fs.writeFile(file,'[]');
  await assert.rejects(()=>loadConfig(file));
});
