const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {defaults}=require('../../src/wallpaper/schema.cjs'),{createStore}=require('../../src/wallpaper/store.cjs');
const {resolvePaths}=require('../../src/companion/paths.cjs'),{migrateData}=require('../../src/companion/migration.cjs');
test('host-virtualized AppData cannot change the default independent root',()=>{
 const environment={USERPROFILE:'C:\\Users\\fixture',LOCALAPPDATA:'C:\\Users\\fixture\\AppData\\Local\\Packages\\OpenAI.Codex_x\\LocalCache\\Local'};
 assert.equal(resolvePaths({environment}).root,path.resolve('C:/Users/fixture/.codex-wallpaper'));
 assert.equal(resolvePaths({environment:{...environment,CODEX_WALLPAPER_ROOT:'C:/fixture/CodexWallpaper'}}).root,path.resolve('C:/fixture/CodexWallpaper'));
});
test('migration preserves preferences, imports and presets without overwriting newer data',async()=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'cw-migrate-')),paths=resolvePaths({localAppData:base}),legacyRoot=path.join(base,'legacy');
 const old=defaults();old.enabled=false;old.reading.offsetX=-64;old.materials.sidebar.alpha=.5;old.wallpaper.selectedId='local:12345678-1234-1234-1234-123456789012';
 await createStore(legacyRoot).save(old);for(const dir of ['presets','imports']){await fs.mkdir(path.join(legacyRoot,dir),{recursive:true});await fs.writeFile(path.join(legacyRoot,dir,'fixture.txt'),dir)}
 await fs.writeFile(path.join(legacyRoot,'private-chat.png'),'excluded');
 const first=await migrateData({legacyRoot,paths});assert.equal(first.migrated,true);assert.ok(first.backupId);
 const store=createStore(paths.data),current=await store.load();assert.deepEqual(current,old);assert.equal(await fs.readFile(path.join(paths.data,'imports/fixture.txt'),'utf8'),'imports');
 await assert.rejects(fs.access(path.join(paths.data,'private-chat.png')));current.reading.offsetX=-80;await store.save(current);
 assert.equal((await migrateData({legacyRoot,paths})).migrated,false);assert.equal((await store.load()).reading.offsetX,-80);
 assert.deepEqual(await createStore(legacyRoot).load(),old);
});
test('invalid settings and symlinks fail without publishing defaults or changing the source',async()=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'cw-invalid-')),paths=resolvePaths({localAppData:base}),legacyRoot=path.join(base,'legacy');await fs.mkdir(legacyRoot);
 await fs.writeFile(path.join(legacyRoot,'user-settings.json'),'{invalid');await assert.rejects(migrateData({legacyRoot,paths}),{code:'SETTINGS_INVALID'});
 await assert.rejects(fs.access(path.join(paths.data,'user-settings.json')));assert.equal(await fs.readFile(path.join(legacyRoot,'user-settings.json'),'utf8'),'{invalid');
 await fs.unlink(path.join(legacyRoot,'user-settings.json'));await createStore(legacyRoot).save(defaults());await fs.symlink(base,path.join(legacyRoot,'imports'),'junction');
 await assert.rejects(migrateData({legacyRoot,paths}),/link|連結/i);await assert.rejects(fs.access(path.join(paths.data,'user-settings.json')));
});
