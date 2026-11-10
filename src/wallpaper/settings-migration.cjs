const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const {atomicJson}=require('../config.cjs'),{upgradeSettings}=require('./schema.cjs');
const tails=new Map();
function settingsLock(root,work){const key=path.resolve(root),previous=tails.get(key)||Promise.resolve(),next=previous.then(work);const tail=next.catch(()=>{});tails.set(key,tail);tail.finally(()=>{if(tails.get(key)===tail)tails.delete(key)});return next}
async function readRawSettings(root){
 const file=path.join(root,'user-settings.json');try{const handle=await fs.open(file,'r');try{if((await handle.stat()).size>2*1024*1024)throw new Error('Settings exceed 2 MiB');const bytes=await handle.readFile();if(bytes.length>2*1024*1024)throw new Error('Settings exceed 2 MiB');return {bytes,raw:JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''))}}finally{await handle.close()}}catch(error){if(error.code==='ENOENT')return null;throw error}
}
async function backupLegacySettings(root,record){
 if(!record||!needsMigration(record.raw))return null;
 upgradeSettings(record.raw); // Validate before creating a migration artifact.
 const hash=createHash('sha256').update(record.bytes).digest('hex'),folder=path.join(root,'migration/schema-v2'),file=path.join(folder,hash+'.json');
 await fs.mkdir(folder,{recursive:true});
 try{await fs.writeFile(file,record.bytes,{flag:'wx'})}catch(error){if(error.code!=='EEXIST')throw error;if(!(await fs.readFile(file)).equals(record.bytes))throw new Error('Settings backup mismatch')}
 return file;
}
function needsMigration(raw){return raw.schemaVersion===1||!Object.hasOwn(raw.playback||{},'sceneLive')||!Object.hasOwn(raw.performance||{},'powerSaving')||raw.performance.qualityMode!=='fixed'}
function ensureSettingsV2(root){return settingsLock(root,async()=>{const record=await readRawSettings(root);if(!record)return {migrated:false};const settings=upgradeSettings(record.raw);if(!needsMigration(record.raw))return {migrated:false};const backupFile=await backupLegacySettings(root,record);await atomicJson(path.join(root,'user-settings.json'),settings);return {migrated:true,backupFile}})}
module.exports={ensureSettingsV2,readRawSettings,backupLegacySettings,settingsLock};
