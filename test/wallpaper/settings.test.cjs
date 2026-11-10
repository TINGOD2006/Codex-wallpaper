const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {defaults,validateSettings,mergeSettings}=require('../../src/wallpaper/schema.cjs');
const {createStore}=require('../../src/wallpaper/store.cjs');
const {migrateLegacy,captureLegacyStatus}=require('../../src/wallpaper/migration.cjs');
test('invalid setting patches cannot corrupt the saved configuration',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'wallpaper-settings-'));const store=createStore(root);
  await store.save(defaults());const original=await fs.readFile(path.join(root,'user-settings.json'),'utf8');
  for(const patch of [{enabled:'false'},{reading:{scrim:NaN}},{reading:{blur:25}},{reading:{scale:0}},{playback:{renderFps:14}},{playback:{sceneLive:'false'}},{unknown:true},JSON.parse('{"reading":{"__proto__":{}}}')])assert.throws(()=>mergeSettings(defaults(),patch));
  assert.equal(await fs.readFile(path.join(root,'user-settings.json'),'utf8'),original);
});
test('failed atomic replacement preserves the previous saved data',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'wallpaper-store-'));const store=createStore(root);await store.save(defaults());
  const rename=fs.rename;fs.rename=async()=>{throw Object.assign(new Error('disk unavailable'),{code:'EIO'})};
  try{await assert.rejects(()=>store.save(mergeSettings(defaults(),{reading:{scrim:.3}})),/disk unavailable/)}finally{fs.rename=rename}
  assert.equal((await store.load()).reading.scrim,.84);
});
test('transient Windows sharing violations do not lose a valid settings save',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'wallpaper-sharing-')),store=createStore(root);await store.save(defaults());const rename=fs.rename;let conflicts=2;
 fs.rename=async(...args)=>{if(conflicts-->0)throw Object.assign(new Error('sharing violation'),{code:'EPERM'});return rename(...args)};
 try{await store.save(mergeSettings(defaults(),{reading:{scrim:.6}}))}finally{fs.rename=rename}
 assert.equal((await store.load()).reading.scrim,.6);assert.ok(!(await fs.readdir(root)).some(file=>file.endsWith('.tmp')));
});
test('migration preserves selected scene and reading position while disabling old palette',async()=>{
  const projectRoot=await fs.mkdtemp(path.join(os.tmpdir(),'wallpaper-migrate-')),dataRoot=path.join(projectRoot,'new');await fs.mkdir(path.join(projectRoot,'.state'));
  const palette={surface:'#182630',panel:'#20333f',text:'#edf4f6',muted:'#b7c8d0',accent:'#a3cfcc',selection:'#304d5b'};
  await fs.writeFile(path.join(projectRoot,'config.json'),JSON.stringify({backgroundPath:'assets/a.png',positionX:100,overlayOpacity:.84,palette}));
  await fs.writeFile(path.join(projectRoot,'scene.json'),JSON.stringify({enabled:true,wallpaperDirectory:'C:/scene',renderFps:30,displayFps:12,width:1024,height:660,pauseWhenHidden:true}));
  await fs.writeFile(path.join(projectRoot,'.state/status.json'),JSON.stringify({enabled:false,sceneSelected:true}));
  const resolveSelection=async source=>{assert.equal(source.kind,'scene');return 'steam:fixture:3172471800'};
  const settings=await migrateLegacy({projectRoot,dataRoot,resolveSelection});
  assert.equal(settings.enabled,false);assert.equal(settings.wallpaper.selectedId,'steam:fixture:3172471800');assert.equal(settings.colors.enabled,false);
  assert.equal(settings.reading.x,100);assert.equal(settings.reading.offsetX,-64);assert.equal(settings.reading.scrim,.84);
  assert.equal(settings.performance.resolutionMode,'manual');assert.deepEqual([settings.playback.width,settings.playback.height],[1024,660]);
  assert.equal(JSON.parse(await fs.readFile(path.join(dataRoot,'migration/legacy-palette.json'))).accent,'#a3cfcc');
  await fs.writeFile(path.join(projectRoot,'config.json'),'broken');
  assert.deepEqual(await migrateLegacy({projectRoot,dataRoot,resolveSelection:()=>{throw new Error('must not migrate twice')}}),settings);
});
test('native palette is the default and settings copies cannot mutate one another',()=>{
  const a=defaults(),b=defaults();a.colors.palette.surface='#ffffff';
  assert.equal(b.colors.enabled,false);assert.notEqual(b.colors.palette.surface,a.colors.palette.surface);
  assert.equal(validateSettings(b).schemaVersion,2);
});
test('v0.4 settings gain independent new surfaces without losing saved preferences',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'wallpaper-surface-upgrade-')),old=defaults();old.schemaVersion=1;delete old.performance;old.reading.scrim=.46;old.playback.width=1920;for(const key of ['titlebar','panels','overlays'])delete old.materials[key];await fs.writeFile(path.join(root,'user-settings.json'),JSON.stringify(old));const store=createStore(root),s=await store.load();assert.equal(s.reading.scrim,.46);assert.equal(s.playback.width,1920);for(const key of ['titlebar','panels','overlays'])assert.equal(s.materials[key].enabled,false);await store.save(s);assert.deepEqual(await store.load(),s);
 assert.equal(mergeSettings(s,{playback:{displayFps:60}}).playback.displayFps,60);assert.throws(()=>mergeSettings(s,{playback:{displayFps:61}}));
});
test('daemon status publication cannot overwrite the legacy enabled preference before migration',async()=>{
 const projectRoot=await fs.mkdtemp(path.join(os.tmpdir(),'wallpaper-first-start-')),dataRoot=path.join(projectRoot,'.state/wallpaper');await fs.mkdir(path.join(projectRoot,'.state'),{recursive:true});
 const file=path.join(projectRoot,'.state/status.json');await fs.writeFile(file,JSON.stringify({enabled:true}));await captureLegacyStatus({projectRoot,dataRoot});await fs.writeFile(file,JSON.stringify({state:'disconnected',enabled:false}));
 const next=await migrateLegacy({projectRoot,dataRoot,resolveSelection:async()=>null});assert.equal(next.enabled,true);
});
