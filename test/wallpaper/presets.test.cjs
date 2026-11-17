const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createPresets}=require('../../src/wallpaper/presets.cjs');
const {createStore}=require('../../src/wallpaper/store.cjs'),{defaults}=require('../../src/wallpaper/schema.cjs');
async function fixture(){const dataRoot=await fs.mkdtemp(path.join(os.tmpdir(),'wallpaper-presets-')),store=createStore(dataRoot),s=defaults();s.library.roots=['C:/private/workshop'];s.library.favorites=['missing:1'];await store.save(s);return {dataRoot,store,p:createPresets({dataRoot,store,library:{get:id=>id==='builtin:miku'?{}:null}})}}

test('listing user presets reuses unchanged files and keeps external edits visible',async()=>{
 const {dataRoot,p}=await fixture(),saved=[];
 for(let n=0;n<8;n++)saved.push(await p.save('Preset '+n,defaults()));
 const original=fs.readFile;let paletteReads=0,presetReads=0;
 fs.readFile=async function(file,...args){if(String(file).endsWith('legacy-palette.json'))paletteReads++;if(path.dirname(String(file))===path.join(dataRoot,'presets'))presetReads++;return original.call(this,file,...args)};
 try{
  const first=await p.list();
  assert.equal(first.length,10);
  assert.deepEqual(first.filter(item=>!item.builtin).map(item=>item.id),saved.map(item=>item.id));
  assert.equal(presetReads,8);
  assert.deepEqual(await p.list(),first);
  assert.equal(presetReads,8);
  assert.equal(paletteReads,0);
 }finally{fs.readFile=original}
 const file=path.join(dataRoot,'presets',saved[0].id.slice(5)+'.json'),doc=JSON.parse(await fs.readFile(file,'utf8'));doc.name='Externally edited';await fs.writeFile(file,JSON.stringify(doc));
 assert.equal((await p.list()).find(p=>p.id===saved[0].id).name,'Externally edited');
});
test('preset roundtrip preserves appearance but never exports library paths or session data',async()=>{
 const {dataRoot,store,p}=await fixture(),s=await store.load();s.wallpaper.selectedId='missing:1';s.reading.scrim=.65;
 const saved=await p.save('我的預設',s);await p.rename(saved.id,'新名稱');const file=path.join(dataRoot,'export.json');await p.exportFile(saved.id,file);
 const text=await fs.readFile(file,'utf8');assert.doesNotMatch(text,/private|roots|session|favorites/);const imported=await p.importFile(file),resolved=await p.resolve(imported.id);
 assert.equal(resolved.reading.scrim,.65);assert.deepEqual(resolved.library.roots,s.library.roots);assert.equal((await p.list()).find(x=>x.id===imported.id).missing,true);
 await p.remove(saved.id);assert.ok(!(await p.list()).some(x=>x.id===saved.id));assert.equal((await p.list()).find(x=>x.id===imported.id).name,'新名稱');
});
test('invalid names or schema cannot overwrite saved presets and bundled names are fixed',async()=>{
 const {dataRoot,p}=await fixture(),s=defaults();for(const name of ['', ' '.repeat(5),'x'.repeat(65),'bad\nname'])await assert.rejects(()=>p.save(name,s));
 const saved=await p.save('保留',s),file=path.join(dataRoot,'bad.json');await fs.writeFile(file,JSON.stringify({schemaVersion:9,name:'bad',appearance:{}}));await assert.rejects(()=>p.importFile(file));
 assert.equal((await p.list()).find(x=>x.id===saved.id).name,'保留');await assert.rejects(()=>p.rename('builtin:reading','oops'));
 const builtins=(await p.list()).filter(x=>x.builtin);assert.deepEqual(builtins.map(x=>x.id),['builtin:native','builtin:reading']);for(const x of builtins)assert.equal((await p.resolve(x.id)).colors.enabled,false);
 const before=await fs.readFile(path.join(dataRoot,'user-settings.json'),'utf8');
 for(const id of ['builtin:glass','builtin:legacy-miku'])await assert.rejects(()=>p.resolve(id));
 assert.equal(await fs.readFile(path.join(dataRoot,'user-settings.json'),'utf8'),before);
});

test('deleting user and built-in schemes persists and leaves the applied appearance intact',async()=>{
 const {dataRoot,store,p}=await fixture();
 const applied=await p.resolve('builtin:reading');
 await store.save(applied);
 const local=await p.save('另存的方案',applied);
 await p.remove('builtin:reading');
 await p.remove(local.id);
 const reopened=createPresets({dataRoot,store,library:{get:()=>null}});
 assert.deepEqual((await reopened.list()).map(item=>item.id),['builtin:native']);
 await assert.rejects(()=>reopened.resolve('builtin:reading'),/找不到方案/);
 await assert.rejects(()=>reopened.exportFile('builtin:reading',path.join(dataRoot,'deleted.json')),/找不到方案/);
 await reopened.remove('builtin:native');
 assert.deepEqual(await p.list(),[]);
 assert.deepEqual(await store.load(),applied);
});
