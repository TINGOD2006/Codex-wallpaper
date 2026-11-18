const fs=require('node:fs/promises'),path=require('node:path'),{createReadStream}=require('node:fs'),{createHash}=require('node:crypto');
const {fencedFile}=require('../scene-server.cjs'),{renderError,checkAbort}=require('./errors.cjs');
const {readProjectMetadata}=require('../project-metadata.cjs');
const limits={scene:256*1024**2,video:1024**3,image:10*1024**2};
function sameFileStamp(a,b){return a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.birthtimeMs===b.birthtimeMs&&a.ino===b.ino}
async function inspectEntry(entry,{signal}={}){
 checkAbort(signal);if(!entry||!Object.hasOwn(limits,entry.kind)||typeof entry.id!=='string'||!entry.id||entry.id.length>256)throw new Error('Unsupported wallpaper source');
 const directory=await fs.realpath(entry.directory),mediaPath=await fs.realpath(entry.mediaPath),relative=path.relative(directory,mediaPath);
 if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Media outside source directory');
 const stat=await fs.stat(mediaPath);if(!stat.isFile()||stat.size>limits[entry.kind])throw new Error('Wallpaper media exceeds limit');
 let metadata;
 if(entry.id==='builtin:miku'&&entry.rootId==='builtin'&&entry.kind==='image'&&mediaPath===path.resolve(__dirname,'../../assets/miku-background.png')){const project={type:'image',file:path.basename(mediaPath)};metadata={project,bytes:Buffer.from(JSON.stringify(project)),stamp:null,file:null}}
 else metadata=await readProjectMetadata((await fencedFile(directory,'project.json')).file);
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
