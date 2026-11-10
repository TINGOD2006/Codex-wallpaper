const fs=require('node:fs/promises'),{createHash}=require('node:crypto');
const {fault,relativeName,safePath,fenced,hashFile,sameStamp}=require('./safe-io.cjs');
function manifestHash(manifest){return createHash('sha256').update(JSON.stringify(manifest)).digest('hex')}
async function createPayloadManifest({root,files}){
 await safePath(root);if(!Array.isArray(files)||!files.length||files.length>10000)throw fault('HOOK_HASH_MISMATCH');
 const sorted=[...files].sort(),seen=new Set(),records=[];
 for(const name of sorted){relativeName(name);const key=name.toLowerCase();if(seen.has(key))throw fault('HOOK_HASH_MISMATCH');seen.add(key);
  const file=await fenced(root,name,{singleLink:true}),before=await fs.stat(file);if(!before.isFile())throw fault('HOOK_HASH_MISMATCH');
  const sha256=await hashFile(file);if(!sameStamp(before,await fs.stat(file)))throw fault('HOOK_HASH_MISMATCH');records.push({path:name,size:before.size,sha256});
 }
 return {schemaVersion:1,files:records};
}
async function verifyPayload({root,manifest,expectedHash}){
 try{
  if(!/^[a-f0-9]{64}$/.test(expectedHash)||!manifest||manifest.schemaVersion!==1||!Array.isArray(manifest.files)||Object.keys(manifest).sort().join(',')!=='files,schemaVersion'||manifestHash(manifest)!==expectedHash)throw fault('HOOK_HASH_MISMATCH');
  const current=await createPayloadManifest({root,files:manifest.files.map(file=>file.path)});
  if(manifestHash(current)!==expectedHash)throw fault('HOOK_HASH_MISMATCH');return true;
 }catch(e){throw fault(e.code==='ENOENT'?'HOOK_PAYLOAD_MISSING':'HOOK_HASH_MISMATCH')}
}
module.exports={createPayloadManifest,verifyPayload,manifestHash};
