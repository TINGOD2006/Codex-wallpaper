const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto'),{isDeepStrictEqual}=require('node:util');
const {parseStrictJson}=require('./strict-json.cjs');
const {fault,relativeName,safePath,fenced,sameStamp,exactRead,eachRange,hashRange,hashFile,writeAll}=require('./safe-io.cjs');
const MAX_HEADER=32*1024*1024,MAX_SMALL=4*1024*1024;
const MAIN='.codex-wallpaper/bootstrap.cjs',ADDED=[MAIN,'.codex-wallpaper/host-broker.cjs'];
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
function decode(bytes){try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{throw fault()}}
function encodeHeader(header){const text=Buffer.from(JSON.stringify(header)),size=8+Math.ceil(text.length/4)*4;if(size>MAX_HEADER)throw fault();const out=Buffer.alloc(8+size);out.writeUInt32LE(4);out.writeUInt32LE(size,4);out.writeUInt32LE(size-4,8);out.writeUInt32LE(text.length,12);text.copy(out,16);return out}
function integrity(bytes,blockSize=4*1024*1024){const hash=b=>createHash('sha256').update(b).digest('hex'),blocks=[];for(let n=0;n<bytes.length;n+=blockSize)blocks.push(hash(bytes.subarray(n,n+blockSize)));if(!bytes.length)blocks.push(hash(bytes));return {algorithm:'SHA256',hash:hash(bytes),blockSize,blocks}}
async function readArchive(file){
 file=await safePath(file);const handle=await fs.open(file,'r');try{
  const stamp=await handle.stat();if(!stamp.isFile()||stamp.size<16)throw fault();const first=await exactRead(handle,8,0),size=first.readUInt32LE(4);
  if(first.readUInt32LE(0)!==4||size<8||size>MAX_HEADER||size%4||size>stamp.size-8)throw fault();
  const raw=await exactRead(handle,size,8),length=raw.readUInt32LE(4);if(raw.readUInt32LE(0)!==size-4||8+Math.ceil(length/4)*4!==size)throw fault();
  if(raw.subarray(8+length).some(v=>v!==0))throw fault();const header=parseStrictJson(decode(raw.subarray(8,8+length))),dataOffset=8+size,entries=new Map(),directories=new Map();
  async function walk(node,prefix='',depth=0){
   if(depth>128||entries.size+directories.size>250000||!record(node)||Object.hasOwn(node,'link'))throw fault();
   if(Object.hasOwn(node,'files')){
    if(!record(node.files)||Object.hasOwn(node,'size')||Object.hasOwn(node,'offset'))throw fault();directories.set(prefix,node);const folded=new Set();
    for(const [name,child]of Object.entries(node.files)){relativeName(name);if(name.includes('/')||folded.has(name.toLowerCase()))throw fault();folded.add(name.toLowerCase());await walk(child,prefix?prefix+'/'+name:name,depth+1)}return;
   }
   if(!prefix||!Number.isSafeInteger(node.size)||node.size<0||node.unpacked!==undefined&&typeof node.unpacked!=='boolean'||node.executable!==undefined&&typeof node.executable!=='boolean')throw fault();
   if(node.integrity!==undefined){const i=node.integrity;if(!record(i)||i.algorithm!=='SHA256'||!/^[a-f0-9]{64}$/.test(i.hash)||!Number.isSafeInteger(i.blockSize)||i.blockSize<=0||!Array.isArray(i.blocks)||i.blocks.some(h=>!/^[a-f0-9]{64}$/.test(h)))throw fault()}
   // Signed native sidecars may grow after packing. Preserve metadata AND all disk bytes.
   if(node.unpacked){if(Object.hasOwn(node,'offset'))throw fault();const unpacked=await fenced(file+'.unpacked',prefix),stat=await fs.stat(unpacked);if(!stat.isFile()||stat.size<node.size)throw fault()}
   else if(typeof node.offset!=='string'||!/^(0|[1-9]\d*)$/.test(node.offset)||!Number.isSafeInteger(Number(node.offset))||!Number.isSafeInteger(Number(node.offset)+node.size)||Number(node.offset)+node.size>stamp.size-dataOffset)throw fault();
   entries.set(prefix,node);
  }
  if(!record(header)||!Object.hasOwn(header,'files'))throw fault();await walk(header);
  if(!sameStamp(stamp,await handle.stat()))throw fault('HOOK_HASH_MISMATCH');return {file,header,dataOffset,entries,directories,stamp};
 }finally{await handle.close()}
}
async function readEntry(archive,name){const entry=archive.entries.get(name);if(!entry||entry.size>MAX_SMALL)throw fault();const file=entry.unpacked?await fenced(archive.file+'.unpacked',name):archive.file,offset=entry.unpacked?0:archive.dataOffset+Number(entry.offset),handle=await fs.open(file,'r');try{return await exactRead(handle,entry.size,offset)}finally{await handle.close()}}
function checkAdded(main,files){if(main!==MAIN||!record(files)||!isDeepStrictEqual(Object.keys(files).sort(),[...ADDED].sort())||Object.values(files).some(b=>!Buffer.isBuffer(b)||!b.length||b.length>MAX_SMALL))throw fault()}
function fileMeta(node){const copy={...node};delete copy.offset;return copy}
function directoryMeta(node){const copy={...node};delete copy.files;return copy}
async function entryHash(archive,name){const e=archive.entries.get(name);return e.unpacked?hashFile(await fenced(archive.file+'.unpacked',name)):hashRange(archive.file,archive.dataOffset+Number(e.offset),e.size)}
async function verifyCandidate({source,candidate,allowedMain,addedFiles}){
 checkAdded(allowedMain,addedFiles);const a=await readArchive(source),b=await readArchive(candidate);
 const originalNames=[...a.entries.keys()].sort(),expected=[...originalNames,...ADDED].sort();if(!isDeepStrictEqual([...b.entries.keys()].sort(),expected)||a.directories.has('.codex-wallpaper'))throw fault('HOOK_HASH_MISMATCH');
 if(!isDeepStrictEqual([...b.directories.keys()].sort(),[...a.directories.keys(),'.codex-wallpaper'].sort()))throw fault('HOOK_HASH_MISMATCH');
 // Original offsets stay unchanged. One streaming comparison of their entire data span
 // proves every packed file's bytes, including shared ranges, without 44k file opens.
 const originalDataSize=a.stamp.size-a.dataOffset;
 if(b.stamp.size-b.dataOffset<originalDataSize||await hashRange(a.file,a.dataOffset,originalDataSize)!==await hashRange(b.file,b.dataOffset,originalDataSize))throw fault('HOOK_HASH_MISMATCH');
 let appendedOffset=originalDataSize;for(const name of ['package.json',...ADDED]){const e=b.entries.get(name);if(e.unpacked||e.offset!==String(appendedOffset))throw fault('HOOK_HASH_MISMATCH');appendedOffset+=e.size}
 if(appendedOffset!==b.stamp.size-b.dataOffset)throw fault('HOOK_HASH_MISMATCH');
 for(const [name,node]of a.directories)if(!isDeepStrictEqual(directoryMeta(node),directoryMeta(b.directories.get(name))))throw fault('HOOK_HASH_MISMATCH');
 if(Object.keys(directoryMeta(b.directories.get('.codex-wallpaper'))).length)throw fault('HOOK_HASH_MISMATCH');
 for(const name of originalNames){
  const old=a.entries.get(name),next=b.entries.get(name);
  if(name==='package.json'){
   const before=parseStrictJson(decode(await readEntry(a,name))),after=parseStrictJson(decode(await readEntry(b,name)));if(!record(before)||!record(after)||after.main!==allowedMain)throw fault('HOOK_HASH_MISMATCH');after.main=before.main;
   if(!isDeepStrictEqual(before,after))throw fault('HOOK_HASH_MISMATCH');
   const x=fileMeta(old),y=fileMeta(next);delete x.size;delete y.size;delete x.integrity;delete y.integrity;if(!isDeepStrictEqual(x,y))throw fault('HOOK_HASH_MISMATCH');
   if(old.integrity?!isDeepStrictEqual({...next.integrity},integrity(await readEntry(b,name),old.integrity.blockSize)):next.integrity!==undefined)throw fault('HOOK_HASH_MISMATCH');
  }else if(!isDeepStrictEqual(old,next)||old.unpacked&&await entryHash(a,name)!==await entryHash(b,name))throw fault('HOOK_HASH_MISMATCH');
 }
 for(const name of ADDED){const expectedBytes=addedFiles[name],actual=await readEntry(b,name),entry=b.entries.get(name);if(!actual.equals(expectedBytes)||entry.unpacked||entry.executable||!isDeepStrictEqual({...entry.integrity},integrity(expectedBytes)))throw fault('HOOK_HASH_MISMATCH')}
 if(!sameStamp(a.stamp,await fs.stat(source))||!sameStamp(b.stamp,await fs.stat(candidate)))throw fault('HOOK_HASH_MISMATCH');
 return {ok:true,originalFilesVerified:originalNames.length};
}
async function buildCandidate({source,destination,main,addedFiles}){
 checkAdded(main,addedFiles);source=await safePath(source);destination=await safePath(destination,{missingLeaf:true});
 if(source.toLowerCase()===destination.toLowerCase())throw fault();
 for(const p of [destination,destination+'.unpacked']){try{await fs.lstat(p);throw fault('HOOK_RESTORE_CONFLICT')}catch(e){if(e.code!=='ENOENT')throw e}}
 const original=await readArchive(source);if(original.directories.has('.codex-wallpaper')||original.entries.has('.codex-wallpaper'))throw fault();
 const pkgEntry=original.entries.get('package.json');if(!pkgEntry||pkgEntry.unpacked)throw fault();
 const pkg=parseStrictJson(decode(await readEntry(original,'package.json')));if(!record(pkg)||typeof pkg.main!=='string')throw fault();relativeName(pkg.main);if(!original.entries.has(pkg.main))throw fault();pkg.main=main;
 const pkgBytes=Buffer.from(JSON.stringify(pkg)),header=parseStrictJson(JSON.stringify(original.header));let offset=original.stamp.size-original.dataOffset;
 header.files['package.json']={...pkgEntry,size:pkgBytes.length,offset:String(offset)};if(pkgEntry.integrity)header.files['package.json'].integrity=integrity(pkgBytes,pkgEntry.integrity.blockSize);offset+=pkgBytes.length;
 const files=Object.create(null);for(const name of ADDED){const bytes=addedFiles[name];files[path.posix.basename(name)]={size:bytes.length,offset:String(offset),integrity:integrity(bytes)};offset+=bytes.length}header.files['.codex-wallpaper']={files};
 const target=await fs.open(destination,'wx');try{
  await writeAll(target,encodeHeader(header));await eachRange(source,original.dataOffset,original.stamp.size-original.dataOffset,chunk=>writeAll(target,chunk));await writeAll(target,pkgBytes);for(const name of ADDED)await writeAll(target,addedFiles[name]);await target.sync();
 }finally{await target.close()}
 for(const [name,entry]of original.entries)if(entry.unpacked){
  const from=await fenced(source+'.unpacked',name),to=path.join(destination+'.unpacked',...name.split('/')),stat=await fs.stat(from);await fs.mkdir(path.dirname(to),{recursive:true});await safePath(path.dirname(to));const out=await fs.open(to,'wx');try{await eachRange(from,0,stat.size,chunk=>writeAll(out,chunk));await out.chmod(stat.mode);await out.sync()}finally{await out.close()}
 }
 if(!sameStamp(original.stamp,await fs.stat(source)))throw fault('HOOK_HASH_MISMATCH');await verifyCandidate({source,candidate:destination,allowedMain:main,addedFiles});
 return {changedEntries:['package.json'],addedEntries:[...ADDED],sourceHash:await hashFile(source),candidateHash:await hashFile(destination)};
}
module.exports={readArchive,readEntry,buildCandidate,verifyCandidate};
