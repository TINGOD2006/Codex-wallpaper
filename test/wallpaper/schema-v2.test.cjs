const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {defaults,upgradeSettings,mergeSettings}=require('../../src/wallpaper/schema.cjs');
const {ensureSettingsV2}=require('../../src/wallpaper/settings-migration.cjs');
const {createStore}=require('../../src/wallpaper/store.cjs');
const {createPresets}=require('../../src/wallpaper/presets.cjs');
function legacy(){const s=defaults();s.schemaVersion=1;delete s.performance;s.playback.width=1024;s.playback.height=660;s.reading.scrim=.28;s.wallpaper.selectedId='fixture:scene';return s}
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cw-v2-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root}
test('v1 migration backs up original bytes once and preserves every preference',async t=>{
 const root=await fixture(t),old=legacy(),raw=Buffer.from('\uFEFF'+JSON.stringify(old,null,2));
 await fs.writeFile(path.join(root,'user-settings.json'),raw);
 const result=await ensureSettingsV2(root),saved=await createStore(root).load();
 assert.deepEqual(await fs.readFile(result.backupFile),raw);assert.equal(saved.schemaVersion,2);
 assert.equal(saved.performance.resolutionMode,'manual');for(const key of Object.keys(old).filter(k=>k!=='schemaVersion'))assert.deepEqual(saved[key],old[key]);
 assert.equal((await ensureSettingsV2(root)).migrated,false);
 assert.equal((await fs.readdir(path.dirname(result.backupFile))).length,1);
});
test('load upgrades in memory only; first save preserves original backup',async t=>{
 const root=await fixture(t),file=path.join(root,'user-settings.json'),raw=JSON.stringify(legacy());await fs.writeFile(file,raw);
 const store=createStore(root),s=await store.load();assert.equal(s.schemaVersion,2);assert.equal(await fs.readFile(file,'utf8'),raw);
 await store.save(mergeSettings(s,{reading:{scrim:.4}}));const files=await fs.readdir(path.join(root,'migration/schema-v2'));
 assert.equal(await fs.readFile(path.join(root,'migration/schema-v2',files[0]),'utf8'),raw);assert.equal((await store.load()).reading.scrim,.4);
});
test('backup or replacement failure preserves original settings',async t=>{
 const root=await fixture(t),file=path.join(root,'user-settings.json'),raw=JSON.stringify(legacy());await fs.writeFile(file,raw);
 await fs.writeFile(path.join(root,'migration'),'blocked');await assert.rejects(ensureSettingsV2(root));assert.equal(await fs.readFile(file,'utf8'),raw);
 await fs.unlink(path.join(root,'migration'));const rename=fs.rename;fs.rename=async()=>{throw Object.assign(new Error('disk failure'),{code:'EIO'})};
 try{await assert.rejects(ensureSettingsV2(root),/disk failure/)}finally{fs.rename=rename}
 assert.equal(await fs.readFile(file,'utf8'),raw);await ensureSettingsV2(root);
});
test('invalid settings do not migrate and performance enums remain strict',async t=>{
 const root=await fixture(t),old=legacy();old.unknown=true;const raw=JSON.stringify(old);await fs.writeFile(path.join(root,'user-settings.json'),raw);
 await assert.rejects(ensureSettingsV2(root));assert.equal(await fs.readFile(path.join(root,'user-settings.json'),'utf8'),raw);
 for(const patch of [{rendererMode:'bad'},{resolutionMode:'bad'},{qualityMode:'adaptive'},{cacheEnabled:'yes'},{extra:1}])assert.throws(()=>mergeSettings(defaults(),{performance:patch}));
 assert.equal(upgradeSettings(legacy()).performance.resolutionMode,'manual');assert.equal(defaults().performance.resolutionMode,'window');
});
test('appearance presets retain current renderer preferences and schema one export',async t=>{
 const root=await fixture(t),store=createStore(root),s=defaults();s.performance.rendererMode='isolated';s.performance.cacheEnabled=false;await store.save(s);
 const presets=createPresets({dataRoot:root,store,library:{get:()=>null}}),saved=await presets.save('外觀',defaults()),resolved=await presets.resolve(saved.id);
 assert.deepEqual(resolved.performance,s.performance);const file=path.join(root,'export.json');await presets.exportFile(saved.id,file);const doc=JSON.parse(await fs.readFile(file));assert.equal(doc.schemaVersion,1);assert.equal(doc.appearance.performance,undefined);
});
