const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs/promises');
const {ThemeSession}=require('../src/session.cjs');
const config={...require('../config.json'),backgroundPath:path.join(__dirname,'../assets/miku-background.png')};
class Host {
  structure={rootViewportCount:1,loginSurfaceCount:1,editorCount:0,buttonCount:3};
  css=null;disconnected=false;failNextWrite=false;writes=0;
  async inspect(){if(this.disconnected)throw new Error('closed');return {...this.structure,documentToken:'document-1',themeStylePresent:this.css!==null};}
  async validateImage(){if(this.disconnected)throw new Error('closed');}
  async set(css,guard){if(this.disconnected)throw new Error('closed');if(guard&&JSON.stringify(this.structure)!==guard.structureKey){const error=new Error('Layout changed');error.code='LAYOUT_CHANGED';throw error;}this.css=css;this.writes++;if(this.failNextWrite){this.failNextWrite=false;throw new Error('paint failed');}}
  async remove(){if(this.disconnected)throw new Error('closed');this.css=null;}
}
function session(host){return new ThemeSession(host,{appVersion:'26.1021.3705.0'});}
test('reapplying replaces a single style and disable removes it',async()=>{
  const host=new Host(),s=session(host);
  await s.apply({...config,overlayOpacity:.4});const previousCss=host.css;
  await s.apply({...config,overlayOpacity:.8});
  assert.equal(s.status.state,'applied');assert.equal(typeof host.css,'string');
  assert.notEqual(host.css,previousCss);assert.equal(host.writes,2);
  const restored=await s.disable();assert.equal(host.css,null);assert.equal(restored.state,'disabled');
  await s.refresh();assert.equal(host.css,null);
});
test('missing background preserves the last complete theme',async()=>{
  const host=new Host(),s=session(host);await s.apply(config);const original=host.css;
  await assert.rejects(()=>s.apply({...config,backgroundPath:'missing-background.png'}));
  assert.equal(host.css,original);assert.equal(s.status.state,'applied');
});
test('partial write failure rolls back the previous complete style',async()=>{
  const host=new Host(),s=session(host);await s.apply(config);const original=host.css;
  host.failNextWrite=true;
  await assert.rejects(()=>s.apply({...config,overlayOpacity:.2}),/paint failed/);
  assert.equal(host.css,original);assert.equal(s.status.state,'applied');
});
test('disabled state wins over an in-flight application',async()=>{
  const host=new Host(),s=session(host);
  const applied=s.apply(config);const disabled=s.disable();
  await Promise.all([applied,disabled]);assert.equal(host.css,null);assert.equal(s.status.state,'disabled');
});
test('disconnect cannot claim successful restoration',async()=>{
  const host=new Host(),s=session(host);await s.apply(config);host.disconnected=true;
  assert.equal((await s.disable()).state,'restore-unconfirmed');assert.notEqual(host.css,null);
  host.disconnected=false;await s.refresh();assert.equal(host.css,null);assert.equal(s.status.state,'disabled');
});
test('unknown authenticated layout clears the login theme instead of guessing',async()=>{
  const host=new Host(),s=session(host);await s.apply(config);
  host.structure={...host.structure,editorCount:1,loginSurfaceCount:0};
  assert.equal((await s.refresh()).state,'unsupported');assert.equal(host.css,null);
});
test('refresh restores the theme after a document reload, with disable still respected',async()=>{
  const host=new Host(),s=session(host);await s.apply(config);host.css=null;
  await s.refresh({documentReloaded:true});assert.equal(s.status.state,'applied');assert.ok(host.css);
  await s.disable();await s.refresh({documentReloaded:true});assert.equal(host.css,null);
});
async function removableImage(t){
  const base=path.join(__dirname,'../.state/tests');await fs.mkdir(base,{recursive:true});
  const dir=await fs.mkdtemp(path.join(base,'reload-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'image.png');await fs.copyFile(config.backgroundPath,file);return file;
}
test('missing image after reload cannot retain an applied status without a style',async t=>{
  const image=await removableImage(t),host=new Host(),s=session(host);
  await s.apply({...config,backgroundPath:image});await fs.unlink(image);host.css=null;
  await assert.rejects(()=>s.refresh({documentReloaded:true}));
  assert.notEqual(s.status.state,'applied');assert.equal(host.css,null);
});
test('unsupported layout removes global theme even when the source image disappeared',async t=>{
  const image=await removableImage(t),host=new Host(),s=session(host);
  await s.apply({...config,backgroundPath:image});await fs.unlink(image);
  host.structure={...host.structure,editorCount:1,loginSurfaceCount:0};
  assert.equal((await s.refresh()).state,'unsupported');assert.equal(host.css,null);
});
test('layout changing during decode cannot receive login CSS or an old rollback',async()=>{
  const host=new Host(),s=session(host);await s.apply(config);
  host.validateImage=async()=>{host.structure={...host.structure,editorCount:1,loginSurfaceCount:0};};
  await assert.rejects(()=>s.apply({...config,overlayOpacity:.2}),/changed/i);
  assert.notEqual(s.status.state,'applied');assert.equal(host.css,null);
});
