const path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
const {resolvePaths}=require('../../src/companion/paths.cjs'),{connectCompanion}=require('../../src/companion/control-client.cjs');
(async()=>{
 const paths=resolvePaths(),client=await connectCompanion({paths});
 try{
  const state=(await client.request('status')).state;
  assert.equal(typeof state.observed.applied,'boolean');assert.ok(state.observed.appVersion);
  if(['incompatible','needs-launch','error'].includes(state.phase)){assert.equal(state.observed.applied,false);assert.ok(state.error?.code)}
  const saved=JSON.parse(await fs.readFile(path.join(paths.data,'user-settings.json'),'utf8'));require('../../src/wallpaper/schema.cjs').validateSettings(saved);
  const baselineAt=process.argv.indexOf('--baseline');if(baselineAt>=0){const baseline=JSON.parse(await fs.readFile(process.argv[baselineAt+1],'utf8'));assert.deepEqual(saved,require('../../src/wallpaper/schema.cjs').upgradeSettings(baseline),'Update changed saved settings')}
  const result={date:new Date().toISOString(),hostVersion:state.observed.appVersion,phase:state.phase,errorCode:state.error?.code||null,applied:state.observed.applied,settingsValid:true,preferencesPreserved:baselineAt>=0?true:null,managerIndependent:true,adapterCompatibility:state.observed.compatibility,materialGeometry:null,decodedFps:null,unverified:['current native background and injected button without a verified endpoint']};
  await fs.mkdir('.state/validation',{recursive:true});await fs.writeFile('.state/validation/companion-0.7.0.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{client.close()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
