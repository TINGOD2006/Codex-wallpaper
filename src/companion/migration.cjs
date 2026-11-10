const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {createReadStream}=require('node:fs');
const {createStore}=require('../wallpaper/store.cjs'),{atomicJson}=require('../config.cjs');
const allowed=['user-settings.json','presets','imports','migration'];
async function digest(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex')}
async function copySafe(source,destination){
 const stat=await fs.lstat(source);if(stat.isSymbolicLink())throw new Error('Migration rejects symbolic links');
 if(stat.isDirectory()){
  const target=await fs.lstat(destination).catch(e=>{if(e.code!=='ENOENT')throw e});if(target&&(!target.isDirectory()||target.isSymbolicLink()))throw new Error('Migration target is not a directory');
  await fs.mkdir(destination,{recursive:true});for(const name of await fs.readdir(source))await copySafe(path.join(source,name),path.join(destination,name));
 }else if(stat.isFile()){
  await fs.mkdir(path.dirname(destination),{recursive:true});
  try{await fs.copyFile(source,destination,fs.constants.COPYFILE_EXCL)}catch(e){if(e.code!=='EEXIST')throw e;const existing=await fs.lstat(destination);if(!existing.isFile()||existing.isSymbolicLink()||await digest(source)!==await digest(destination))throw new Error('Migration refuses to overwrite existing data')}
 }else throw new Error('Migration rejects non-file resources');
}
async function migrateData({legacyRoot,paths}){
 const target=createStore(paths.data);
 try{await fs.access(path.join(paths.data,'user-settings.json'));await target.load();return {migrated:false,backupId:null}}catch(e){if(e.code!=='ENOENT')throw Object.assign(e,{code:'SETTINGS_INVALID'})}
 if(!legacyRoot)return {migrated:false,backupId:null};
 const relative=path.relative(path.resolve(legacyRoot),paths.data);if(!relative||!relative.startsWith('..')&&!path.isAbsolute(relative))throw new Error('Migration roots overlap');
 try{await fs.access(path.join(legacyRoot,'user-settings.json'))}catch(e){if(e.code==='ENOENT')return {migrated:false,backupId:null};throw e}
 const backupId=randomUUID(),backup=path.join(paths.root,'backups',backupId);
 try{
  for(const name of allowed){const source=path.join(legacyRoot,name);try{await fs.lstat(source)}catch(e){if(e.code==='ENOENT')continue;throw e}await copySafe(source,path.join(backup,name))}
  const value=await createStore(backup).load();
  for(const name of allowed.filter(name=>name!=='user-settings.json')){const source=path.join(backup,name);try{await fs.lstat(source)}catch(e){if(e.code==='ENOENT')continue;throw e}await copySafe(source,path.join(paths.data,name))}
  await target.save(value);await atomicJson(path.join(paths.data,'migration/companion-v1.json'),{schemaVersion:1,backupId,completedAt:new Date().toISOString()});
  return {migrated:true,backupId};
 }catch(e){throw Object.assign(e,{code:'SETTINGS_INVALID'})}
}
module.exports={migrateData};
