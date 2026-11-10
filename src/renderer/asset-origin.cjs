const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),{createReadStream}=require('node:fs'),{randomUUID}=require('node:crypto');
const {atomicJson}=require('../config.cjs'),{fencedFile}=require('../scene-server.cjs'),{inspectEntry}=require('./source-fingerprint.cjs'),{renderError,checkAbort}=require('./errors.cjs'),{parseRange}=require('./resource-http.cjs');
const projectRoot=path.resolve(__dirname,'../..');
const assets={
 'index.html':['src/scene-renderer/index.html','text/html'],
 'renderer.js':['src/scene-renderer/renderer.js','text/javascript'],
 'engine.js':['assets/webwallgl/webwallgl.global.min.js','text/javascript'],
 'cache-policy.js':['src/renderer/cache-policy.js','text/javascript'],
 'cache-adapter.js':['src/scene-renderer/cache-adapter.js','text/javascript'],
 'cache-index.js':['src/scene-renderer/cache-index.js','text/javascript'],
 'control.html':['src/scene-renderer/control.html','text/html'],
 'probe.html':['src/scene-renderer/probe.html','text/html'],
 'probe.js':['src/scene-renderer/probe.js','text/javascript']
};
const mimes={'.mp4':'video/mp4','.m4v':'video/mp4','.mov':'video/quicktime','.webm':'video/webm','.mkv':'video/x-matroska','.ogv':'video/ogg','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.json':'application/json','.ogg':'audio/ogg'};
function createAssetOrigin({paths}){
 let server,startJob,origin,coldOrigin=false,closed=false;const leases=new Map(),controlToken=randomUUID(),portFile=path.join(paths.data,'renderer-origin.json');
 async function sendFile(req,res,file,stat,type,streams){
  const range=parseRange(req.headers.range,stat.size);if(!range){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});res.end();return}
  const {start,end,partial}=range;res.setHeader('Content-Type',type);res.setHeader('Accept-Ranges','bytes');res.setHeader('Content-Length',Math.max(0,end-start+1));if(partial){res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${stat.size}`)}
  if(req.method==='HEAD'||stat.size===0){res.end();return}const stream=createReadStream(file,{start,end});streams?.add(stream);stream.on('error',()=>res.destroy());res.on('close',()=>{streams?.delete(stream);stream.destroy()});stream.pipe(res);
 }
 function json(req,res,value){const bytes=Buffer.from(JSON.stringify(value));res.setHeader('Content-Type','application/json');res.setHeader('Content-Length',bytes.length);res.end(req.method==='HEAD'?undefined:bytes)}
 async function handle(req,res){
  try{
   if(req.headers.host!==new URL(origin).host){res.writeHead(403);res.end();return}
   if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return}
   if(!req.url||req.url.length>8192||/%25|%00|%5c|\\/i.test(req.url))throw new Error('Invalid resource URL');
   const pathname=new URL(req.url,origin).pathname,match=/^\/([\da-f-]{36})\/(.*)$/.exec(pathname);if(!match)throw new Error('Unknown capability');
   const lease=leases.get(match[1]),isControl=match[1]===controlToken;if(!lease&&!isControl)throw new Error('Expired capability');
   const name=decodeURIComponent(match[2])||'index.html';if(name.split('/').some(x=>x==='..'||x==='.')||name.includes('\\')||name.includes('\0'))throw new Error('Invalid resource path');
   res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self' blob:; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'");
   if(assets[name]){const [relative,type]=assets[name],file=path.join(projectRoot,relative);await sendFile(req,res,file,await fs.stat(file),type,lease?.streams);return}
   if(!lease)throw new Error('Control resource rejected');
   if(name==='render-config.json'){json(req,res,lease.config);return}
   if(name==='project.json'){json(req,res,{...lease.project,type:lease.entry.kind,file:lease.mediaName});return}
   if(name===lease.mediaName){if(await fs.realpath(lease.mediaPath)!==lease.mediaPath)throw renderError('SOURCE_CHANGED');const stat=await fs.stat(lease.mediaPath);if(stat.size!==lease.stat.size||stat.mtimeMs!==lease.stat.mtimeMs)throw renderError('SOURCE_CHANGED');await sendFile(req,res,lease.mediaPath,stat,mimes[path.extname(lease.mediaPath).toLowerCase()]||'application/octet-stream',lease.streams);return}
   if(lease.entry.kind==='scene'){const {file,stat}=await fencedFile(lease.directory,name);await sendFile(req,res,file,stat,mimes[path.extname(file).toLowerCase()]||'application/octet-stream',lease.streams);return}
   throw new Error('Unknown media resource');
  }catch{if(!res.headersSent)res.writeHead(404);res.end()}
 }
 async function start(){
  if(closed)throw renderError('POOL_CLOSED');if(startJob)return startJob;
  startJob=(async()=>{let preferred=0;try{const saved=JSON.parse(await fs.readFile(portFile,'utf8'));if(Number.isInteger(saved.port)&&saved.port>1023&&saved.port<65536)preferred=saved.port}catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error}
   server=http.createServer((req,res)=>{handle(req,res).catch(()=>res.destroy())});
   const listen=port=>new Promise((resolve,reject)=>{const failed=error=>{server.off('listening',ready);reject(error)},ready=()=>{server.off('error',failed);resolve()};server.once('error',failed);server.once('listening',ready);server.listen(port,'127.0.0.1')});
   try{await listen(preferred)}catch(error){if(error.code!=='EADDRINUSE'||!preferred)throw error;coldOrigin=true;await listen(0)}
   origin=`http://127.0.0.1:${server.address().port}`;if(!coldOrigin)await atomicJson(portFile,{port:server.address().port});
   return {origin,coldOrigin};
  })();try{return await startJob}catch(error){startJob=null;server?.close();throw error}
 }
 async function register(entry,{signal,entryFingerprint,identity={},playback={},cachePolicy={enabled:false}}={}){
  checkAbort(signal);await start();if(closed)throw renderError('POOL_CLOSED');if(!/^[\da-f]{64}$/.test(entryFingerprint||''))throw new Error('Missing content fingerprint');if(leases.size>=4)throw renderError('POOL_UNAVAILABLE');
  const source=await inspectEntry(entry,{signal}),id=randomUUID(),assetBase=origin+'/'+id+'/',sourceKey='codex:'+entry.id+':'+entryFingerprint;
  const leaseId=identity.leaseId||id,mediaName=entry.kind==='scene'?'scene.pkg':'media'+path.extname(source.mediaPath).toLowerCase();
  const config={leaseId,sourceKey,assetBase,entryFingerprint,identity:{managerInstance:identity.managerInstance,hostGeneration:identity.hostGeneration,rendererGeneration:identity.rendererGeneration},playback:{width:playback.width||1920,height:playback.height||1080,qualityMode:['low','balanced'].includes(playback.qualityMode)?playback.qualityMode:'fixed',renderFps:playback.renderFps||30,muted:playback.muted!==false,volume:playback.volume||0},cachePolicy:structuredClone(cachePolicy)};
  for(const [key,min,max]of [['width',1,1920],['height',1,1080],['renderFps',15,60]])if(!Number.isInteger(config.playback[key])||config.playback[key]<min||config.playback[key]>max)throw new Error('Invalid render bootstrap');
  if(!Number.isFinite(config.playback.volume)||config.playback.volume<0||config.playback.volume>1)throw new Error('Invalid render volume');
  checkAbort(signal);leases.set(id,{...source,entry,mediaName,config,streams:new Set()});
  return {sourceKey,assetBase,rendererUrl:assetBase,leaseId,revoke(){const lease=leases.get(id);if(!lease)return;leases.delete(id);for(const stream of lease.streams)stream.destroy()}};
 }
 return {start,register,openControl(){if(!origin||closed)throw renderError('POOL_CLOSED');return origin+'/'+controlToken+'/control.html'},openProbe(){if(!origin||closed)throw renderError('POOL_CLOSED');return origin+'/'+controlToken+'/probe.html'},async close(){closed=true;for(const lease of leases.values())for(const stream of lease.streams)stream.destroy();leases.clear();await startJob?.catch(()=>{});if(server?.listening)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections()})}};
}
module.exports={createAssetOrigin};
