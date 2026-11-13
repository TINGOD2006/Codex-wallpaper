const fs=require('node:fs/promises'),path=require('node:path');
const {loadImage,atomicJson}=require('../config.cjs');
const EMPTY='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=';
function usesStill(entry,playback){return !!entry&&(entry.kind==='scene'&&playback.sceneLive===false||['scene','video'].includes(entry.kind)&&playback.powerSaving===true)}
function validFrame(uri){return typeof uri==='string'&&uri.length<=8*1024*1024&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(uri)}
async function preloadSceneStill({entry,dataRoot,signal}){
 const candidates=[],cache=path.join(dataRoot,'last-wallpaper-frame.json');
 const add=(uri,source)=>{if(validFrame(uri)&&!candidates.some(c=>c.uri===uri))candidates.push({uri,source})};
 try{signal?.throwIfAborted();if((await fs.stat(cache)).size<=8*1024*1024){const saved=JSON.parse(await fs.readFile(cache,'utf8'));if(saved.selectedId===entry.id)add(saved.uri,'cache')}}catch(error){signal?.throwIfAborted()}
 if(entry.previewPath||entry.kind==='image'&&entry.mediaPath)try{
  signal?.throwIfAborted();
  const base=await fs.realpath(entry.directory),file=await fs.realpath(entry.previewPath||entry.mediaPath);
  if(file.startsWith(base+path.sep)&&(await fs.stat(file)).size<=8*1024*1024)add((await loadImage(file)).dataUri,'preview');
 }catch{signal?.throwIfAborted()}
 signal?.throwIfAborted();return candidates;
}
async function resolveSceneStill({entry,dataRoot,preferredFrame,preloaded,validate=async()=>{},signal}){
 const cache=path.join(dataRoot,'last-wallpaper-frame.json');
 const check=async(uri,source)=>{signal?.throwIfAborted();if(!validFrame(uri))return null;try{await validate(uri);signal?.throwIfAborted();return {uri,source}}catch(error){signal?.throwIfAborted();return null}};
 let result=await check(preferredFrame,'captured');
 if(result){await atomicJson(cache,{selectedId:entry.id,uri:result.uri}).catch(()=>{});return result}
 const candidates=preloaded?.selectedId===entry.id?preloaded.candidates:await preloadSceneStill({entry,dataRoot,signal});
 for(const candidate of candidates){result=await check(candidate.uri,candidate.source);if(result)return result}
 signal?.throwIfAborted();return {uri:EMPTY,source:'empty'};
}
function createStillRenderer({uri,source,preview=false}){
 if(!validFrame(uri))throw Error('Invalid scene still');
 let state='ready',image=uri;
 return {get status(){return {state,still:true,preview,backend:'image',staticSource:source,renderFps:0,captureFps:0}},frame:async()=>image,pause:async()=>{state='paused'},resume:async()=>{state='ready'},setPlayback:async value=>{state=value.paused?'paused':'ready'},close:async()=>{state='stopped';image=null}};
}
module.exports={preloadSceneStill,resolveSceneStill,createStillRenderer,validFrame,usesStill};
