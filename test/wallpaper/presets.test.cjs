const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createPresets}=require('../../src/wallpaper/presets.cjs');
const {createStore}=require('../../src/wallpaper/store.cjs'),{defaults}=require('../../src/wallpaper/schema.cjs');
async function fixture(){const dataRoot=await fs.mkdtemp(path.join(os.tmpdir(),'wallpaper-presets-')),store=createStore(dataRoot),s=defaults();s.library.roots=['C:/private/workshop'];s.library.favorites=['missing:1'];await store.save(s);return {dataRoot,store,p:createPresets({dataRoot,store,library:{get:id=>id==='builtin:miku'?{}:null}})}}

test('listing user presets reads the legacy palette once and keeps external edits visible',async()=>{
 const {dataRoot,p}=await fixture(),saved=[];
 for(let n=0;n<8;n++)saved.push(await p.save('Preset '+n,defaults()));
 const original=fs.readFile;let paletteReads=0;
 fs.readFile=async function(file,...args){if(String(file).endsWith('legacy-palette.json'))paletteReads++;return original.call(this,file,...args)};
 try{assert.equal((await p.list()).length,12);assert.equal(paletteReads,1)}finally{fs.readFile=original}
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
test('invalid names or schema cannot overwrite saved presets and builtins are immutable',async()=>{
 const {dataRoot,p}=await fixture(),s=defaults();for(const name of ['', ' '.repeat(5),'x'.repeat(65),'bad\nname'])await assert.rejects(()=>p.save(name,s));
 const saved=await p.save('保留',s),file=path.join(dataRoot,'bad.json');await fs.writeFile(file,JSON.stringify({schemaVersion:9,name:'bad',appearance:{}}));await assert.rejects(()=>p.importFile(file));
 assert.equal((await p.list()).find(x=>x.id===saved.id).name,'保留');await assert.rejects(()=>p.remove('builtin:reading'));await assert.rejects(()=>p.rename('builtin:reading','oops'));
 const builtins=(await p.list()).filter(x=>x.builtin);assert.equal(builtins.length,4);for(const x of builtins.filter(x=>x.id!=='builtin:legacy-miku'))assert.equal((await p.resolve(x.id)).colors.enabled,false);
});
