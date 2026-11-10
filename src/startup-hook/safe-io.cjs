const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
function fault(code='HOOK_ARCHIVE_INVALID'){return Object.assign(new Error(code),{code})}
function relativeName(name){
 if(typeof name!=='string'||!name||name.length>4096||name.split('/').some(p=>!p||p==='.'||p==='..'||/[\\:\x00-\x1f<>"|?*]/.test(p)||/[. ]$/.test(p)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))throw fault();
 return name;
}
async function safePath(file,{missingLeaf=false,singleLink=false}={}){
 const absolute=path.resolve(file),root=path.parse(absolute).root,parts=path.relative(root,absolute).split(path.sep).filter(Boolean);let current=root,stat;
 for(let i=0;i<parts.length;i++){
  current=path.join(current,parts[i]);try{stat=await fs.lstat(current)}catch(e){if(e.code==='ENOENT'&&missingLeaf&&i===parts.length-1)return absolute;throw e}
  if(stat.isSymbolicLink()||i<parts.length-1&&!stat.isDirectory())throw fault();
 }
 const real=await fs.realpath(absolute),normalize=p=>process.platform==='win32'?p.toLowerCase():p;
 if(normalize(real)!==normalize(absolute)||singleLink&&stat?.isFile()&&stat.nlink!==1)throw fault();
 return absolute;
}
async function fenced(root,name,options){relativeName(name);await safePath(root);return safePath(path.join(root,...name.split('/')),options)}
function sameStamp(a,b){return a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs}
async function exactRead(handle,length,position){const bytes=Buffer.alloc(length);let n=0;while(n<length){const r=await handle.read(bytes,n,length-n,position+n);if(!r.bytesRead)throw fault();n+=r.bytesRead}return bytes}
async function eachRange(file,start,size,consume){
 await safePath(file);const handle=await fs.open(file,'r');try{
  const before=await handle.stat();if(!before.isFile()||![start,size,start+size].every(Number.isSafeInteger)||start<0||size<0||start+size>before.size)throw fault();
  const buffer=Buffer.alloc(Math.min(size,1024*1024));let offset=0;
  while(offset<size){const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,size-offset),start+offset);if(!bytesRead)throw fault();await consume(buffer.subarray(0,bytesRead));offset+=bytesRead}
  if(!sameStamp(before,await handle.stat())||!sameStamp(before,await fs.stat(file)))throw fault('HOOK_HASH_MISMATCH');
 }finally{await handle.close()}
}
async function hashRange(file,start,size){const hash=createHash('sha256');await eachRange(file,start,size,chunk=>{hash.update(chunk)});return hash.digest('hex')}
async function hashFile(file){return hashRange(file,0,(await fs.stat(await safePath(file))).size)}
async function writeAll(handle,buffer){let n=0;while(n<buffer.length){const r=await handle.write(buffer,n,buffer.length-n);if(!r.bytesWritten)throw fault();n+=r.bytesWritten}}
module.exports={fault,relativeName,safePath,fenced,sameStamp,exactRead,eachRange,hashRange,hashFile,writeAll};
