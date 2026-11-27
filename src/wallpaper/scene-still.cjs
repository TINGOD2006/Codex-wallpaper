const fs=require('node:fs/promises'),path=require('node:path');
const {createHash}=require('node:crypto');
const {loadImage,atomicJson}=require('../config.cjs');
const EMPTY='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=';
function usesStill(entry,playback){return !!entry&&(entry.kind==='scene'&&playback.sceneLive===false||['scene','video'].includes(entry.kind)&&playback.powerSaving===true)}
function validFrame(uri){return typeof uri==='string'&&uri.length<=8*1024*1024&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(uri)}
const frameCache=dataRoot=>path.join(dataRoot,'last-wallpaper-frame.json');
async function frameSource(entry,signal){
 signal?.throwIfAborted();
 if(!entry?.mediaPath)return null;
 try{
  const files=[entry.mediaPath];
  if(entry.directory&&entry.kind!=='image')files.push(path.join(entry.directory,'project.json'));
  const stamps=await Promise.all(files.map(async(file,index)=>{
   const stat=await fs.stat(file).catch(error=>{if(index===0||error.code!=='ENOENT')throw error;return null});
   return stat&&[file,stat.size,stat.mtimeMs,stat.ctimeMs,stat.ino];
  }));
  signal?.throwIfAborted();
  return {version:createHash('sha256').update(JSON.stringify(stamps)).digest('hex'),modifiedAt:Math.max(...stamps.filter(Boolean).map(stamp=>stamp[2]))};
 }catch{signal?.throwIfAborted();return null}
}
function saveStill({dataRoot,selectedId,uri,sourceVersion}){
 return atomicJson(frameCache(dataRoot),{selectedId,uri,...(sourceVersion?{sourceVersion}:{})});
}
async function cachedStill(entry,dataRoot,signal){
 const cache=frameCache(dataRoot);
 try{
  signal?.throwIfAborted();const stat=await fs.stat(cache);
  if(stat.size<=8*1024*1024){
   const saved=JSON.parse(await fs.readFile(cache,'utf8'));
   if(saved.selectedId===entry.id){
    const source=await frameSource(entry,signal);
    const sameSource=saved.sourceVersion?saved.sourceVersion===source?.version:!source||source.modifiedAt<=stat.mtimeMs;
    if(sameSource&&validFrame(saved.uri))return {uri:saved.uri,source:'cache'};
   }
  }
 }catch{signal?.throwIfAborted()}
}
async function authorStill(entry,signal){
 const preview=entry.previewPath||(entry.kind==='image'&&entry.mediaPath);
 if(!preview)return;
 try{
  signal?.throwIfAborted();
  const [base,file]=await Promise.all([fs.realpath(entry.directory),fs.realpath(preview)]);
  if(file.startsWith(base+path.sep)&&(await fs.stat(file)).size<=8*1024*1024){
   const {dataUri:uri}=await loadImage(file);
   signal?.throwIfAborted();
   if(validFrame(uri))return {uri,source:'preview'};
  }
 }catch{signal?.throwIfAborted()}
}
function prepareSceneStill({entry,dataRoot,signal}){
 const cache=cachedStill(entry,dataRoot,signal);
 cache.catch(()=>{});
 let preview;
 return {selectedId:entry.id,async *candidates(){
  const saved=await cache;
  signal?.throwIfAborted();
  if(saved)yield saved;
  signal?.throwIfAborted();
  const author=await (preview??=authorStill(entry,signal));
  if(author&&author.uri!==saved?.uri)yield author;
 }};
}
async function preloadSceneStill(options){
 const candidates=[];
 for await(const candidate of prepareSceneStill(options).candidates())candidates.push(candidate);
 return candidates;
}
async function resolveSceneStill({entry,dataRoot,preferredFrame,preloaded,validate=async()=>{},signal}){
 const check=async(uri,source)=>{signal?.throwIfAborted();if(!validFrame(uri))return null;try{await validate(uri);signal?.throwIfAborted();return {uri,source}}catch(error){signal?.throwIfAborted();return null}};
 let result=await check(preferredFrame,'captured');
 if(result){const source=await frameSource(entry,signal);await saveStill({dataRoot,selectedId:entry.id,uri:result.uri,sourceVersion:source?.version}).catch(()=>{});return result}
 const prepared=preloaded?.selectedId===entry.id?preloaded:prepareSceneStill({entry,dataRoot,signal});
 const candidates=typeof prepared.candidates==='function'?prepared.candidates():prepared.candidates;
 for await(const candidate of candidates){result=await check(candidate.uri,candidate.source);if(result)return result}
 signal?.throwIfAborted();return {uri:EMPTY,source:'empty'};
}
function createStillRenderer({uri,source,preview=false}){
 if(!validFrame(uri))throw Error('Invalid scene still');
 let state='ready',image=uri;
 return {get status(){return {state,still:true,preview,backend:'image',staticSource:source,renderFps:0,captureFps:0}},frame:async()=>image,pause:async()=>{state='paused'},resume:async()=>{state='ready'},setPlayback:async value=>{state=value.paused?'paused':'ready'},close:async()=>{state='stopped';image=null}};
}
module.exports={prepareSceneStill,preloadSceneStill,resolveSceneStill,createStillRenderer,validFrame,usesStill,frameSource,saveStill};
