// Standalone archive entry: no source-tree dependency and no general-purpose IPC.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
function error(code){return Object.assign(Error(code),{code})}
function safeFile(root,name){
 if(typeof name!=='string'||!name||name.split('/').some(n=>!n||n==='.'||n==='..'||/[\\:\x00-\x1f<>"|?*]/.test(n)||/[. ]$/.test(n)))throw error('HOOK_HASH_MISMATCH');
 const absolute=path.resolve(root,...name.split('/')),parts=path.relative(path.parse(absolute).root,absolute).split(path.sep);let current=path.parse(absolute).root;
 for(const part of parts){current=path.join(current,part);const stat=fs.lstatSync(current);if(stat.isSymbolicLink())throw error('HOOK_HASH_MISMATCH')}
 const stat=fs.statSync(absolute);if(!stat.isFile()||stat.nlink!==1||stat.size>4*1024*1024)throw error('HOOK_HASH_MISMATCH');return absolute;
}
function verifyPayloadSync({root,expectedHash}){
 try{
  const manifest=JSON.parse(fs.readFileSync(safeFile(root,'manifest.json'),'utf8')),hash=value=>createHash('sha256').update(value).digest('hex');
  if(!/^[a-f0-9]{64}$/.test(expectedHash)||hash(JSON.stringify(manifest))!==expectedHash||manifest.schemaVersion!==1||!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>128)throw error('HOOK_HASH_MISMATCH');
  const seen=new Set();for(const f of manifest.files){const key=f.path?.toLowerCase();if(seen.has(key))throw error('HOOK_HASH_MISMATCH');seen.add(key);const data=fs.readFileSync(safeFile(root,f.path));if(data.length!==f.size||hash(data)!==f.sha256)throw error('HOOK_HASH_MISMATCH')}
  return manifest;
 }catch(e){throw error(e.code==='ENOENT'?'HOOK_PAYLOAD_MISSING':'HOOK_HASH_MISMATCH')}
}
function registerHostHooks({payloadRoot,payloadHash,report,nodePath}){
 const manifest=verifyPayloadSync({root:payloadRoot,expectedHash:payloadHash});if(!manifest.files.some(f=>f.path==='probe.cjs'))throw error('HOOK_HASH_MISMATCH');
 const electron=require('electron');
 if(!electron.app||typeof electron.app.on!=='function'||!electron.BrowserWindow||typeof electron.BrowserWindow.getAllWindows!=='function')throw error('HOOK_RUNTIME_UNSUPPORTED');
 const payload=require(path.join(payloadRoot,'probe.cjs'));return payload.register({app:electron.app,BrowserWindow:electron.BrowserWindow,report,nodePath});
}
module.exports={verifyPayloadSync,registerHostHooks};
