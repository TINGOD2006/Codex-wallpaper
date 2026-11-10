const fs=require('node:fs/promises'),path=require('node:path'),{createReadStream}=require('node:fs'),{createHash}=require('node:crypto');
const {fencedFile}=require('../scene-server.cjs'),{renderError,checkAbort}=require('./errors.cjs');
const limits={scene:256*1024**2,video:1024**3,image:10*1024**2};
function sameFileStamp(a,b){return a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.birthtimeMs===b.birthtimeMs&&a.ino===b.ino}
async function readProject(directory){
 const {file}=await fencedFile(directory,'project.json'),handle=await fs.open(file,'r'),limit=1024**2;
 try{const stat=await handle.stat();if(stat.size>limit)throw new Error('Project metadata exceeds 1 MiB');const data=Buffer.alloc(limit+1);let size=0;while(size<data.length){const result=await handle.read(data,size,Math.min(65536,data.length-size),size);if(!result.bytesRead)break;size+=result.bytesRead}if(size>limit)throw new Error('Project metadata exceeds 1 MiB');return {bytes:data.subarray(0,size),project:JSON.parse(data.toString('utf8',0,size).replace(/^\uFEFF/,'')),stamp:stat,file}}finally{await handle.close()}
}
async function inspectEntry(entry,{signal}={}){
 checkAbort(signal);if(!entry||!Object.hasOwn(limits,entry.kind)||typeof entry.id!=='string'||!entry.id||entry.id.length>256)throw new Error('Unsupported wallpaper source');
 const directory=await fs.realpath(entry.directory),mediaPath=await fs.realpath(entry.mediaPath),relative=path.relative(directory,mediaPath);
 if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Media outside source directory');
 const stat=await fs.stat(mediaPath);if(!stat.isFile()||stat.size>limits[entry.kind])throw new Error('Wallpaper media exceeds limit');
 let metadata;
 if(entry.id==='builtin:miku'&&entry.rootId==='builtin'&&entry.kind==='image'&&mediaPath===path.resolve(__dirname,'../../assets/miku-background.png')){const project={type:'image',file:path.basename(mediaPath)};metadata={project,bytes:Buffer.from(JSON.stringify(project)),stamp:null,file:null}}
 else metadata=await readProject(directory);
 const sourceKind=String(metadata.project.type).toLowerCase();
 if(sourceKind!==entry.kind){const preview=entry.previewOnly===true&&entry.kind==='image'&&entry.sourceKind===sourceKind&&entry.previewPath&&typeof metadata.project.preview==='string';if(!preview||await fs.realpath(entry.previewPath)!==mediaPath||(await fencedFile(directory,metadata.project.preview)).file!==mediaPath)throw new Error('Source type mismatch')}
 if(entry.kind==='scene'&&relative!=='scene.pkg')throw new Error('Only packaged scenes are supported');
 checkAbort(signal);return {directory,mediaPath,stat,...metadata};
}
async function fingerprintEntry(entry,{signal}={}){
 for(let attempt=0;attempt<2;attempt++){
  const source=await inspectEntry(entry,{signal}),hash=createHash('sha256');hash.update(source.bytes);hash.update('\0');
  for await(const chunk of createReadStream(source.mediaPath,{signal}))hash.update(chunk);
  checkAbort(signal);const mediaAfter=await fs.stat(source.mediaPath),projectAfter=source.file?await fs.stat(source.file):null;
  if(sameFileStamp(source.stat,mediaAfter)&&(!source.stamp||sameFileStamp(source.stamp,projectAfter)))return hash.digest('hex');
 }
 throw renderError('SOURCE_CHANGED');
}
module.exports={fingerprintEntry,inspectEntry,sameFileStamp};
