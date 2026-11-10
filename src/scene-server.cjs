const http=require('node:http');
const fs=require('node:fs/promises');
const {createReadStream}=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..');
async function readSceneConfig(file=path.join(root,'scene.json')){
  const c=JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));
  const keys=['enabled','wallpaperDirectory','renderFps','displayFps','width','height','pauseWhenHidden'];
  if(!c||Array.isArray(c)||Object.keys(c).some(k=>!keys.includes(k))||typeof c.enabled!=='boolean'||typeof c.pauseWhenHidden!=='boolean'||typeof c.wallpaperDirectory!=='string')throw new Error('Invalid scene configuration');
  for(const [k,min,max]of [['renderFps',15,60],['displayFps',1,20],['width',320,1920],['height',240,1080]])if(!Number.isInteger(c[k])||c[k]<min||c[k]>max)throw new Error(`Invalid scene ${k}`);
  return c;
}
async function fencedFile(directory,relative){
  if(!relative||relative.includes('\\')||relative.includes('\0')||relative.split('/').some(p=>p==='..'||p==='.')||path.isAbsolute(relative))throw new Error('Invalid resource path');
  const base=await fs.realpath(directory),file=await fs.realpath(path.join(base,relative));
  if(!file.startsWith(base+path.sep))throw new Error('Resource outside scene directory');
  const stat=await fs.stat(file);if(!stat.isFile()||stat.size>256*1024*1024)throw new Error('Invalid scene resource');
  return {file,stat};
}
async function createSceneServer(config){
  const directory=await fs.realpath(config.wallpaperDirectory);
  const project=JSON.parse(await fs.readFile((await fencedFile(directory,'project.json')).file,'utf8'));
  if(String(project.type).toLowerCase()!=='scene')throw new Error('Only Scene wallpapers are supported by this bridge');
  await fencedFile(directory,'scene.pkg');
  const token=randomUUID(),prefix=`/${token}/`;
  const server=http.createServer(async(req,res)=>{
    try{
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
      const host=req.headers.host||'';if(!/^127\.0\.0\.1:\d+$/.test(host)){res.writeHead(403);res.end();return;}
      const pathname=new URL(req.url,'http://127.0.0.1').pathname;
      if(!pathname.startsWith(prefix)){res.writeHead(404);res.end();return;}
      const name=decodeURIComponent(pathname.slice(prefix.length));
      res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
      res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob: data:; connect-src 'self' blob:; worker-src 'self' blob:; font-src 'self' blob: data:; frame-src 'none'; object-src 'none'; base-uri 'none'");
      if(name==='project.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...project,file:'scene.pkg'}));return;}
      let result,type;
      if(name===''||name==='index.html'){result=await fencedFile(path.join(root,'src/scene-renderer'),'index.html');type='text/html';}
      else if(name==='renderer.js'){result=await fencedFile(path.join(root,'src/scene-renderer'),'renderer.js');type='text/javascript';}
      else if(name==='engine.js'){result=await fencedFile(path.join(root,'assets/webwallgl'),'webwallgl.global.min.js');type='text/javascript';}
      else{result=await fencedFile(directory,name);type=({'.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.ogg':'audio/ogg','.mp4':'video/mp4','.webm':'video/webm'})[path.extname(name)]||'application/octet-stream';}
      res.setHeader('Content-Type',type);res.setHeader('Content-Length',result.stat.size);
      if(req.method==='HEAD'){res.end();return;}
      const stream=createReadStream(result.file);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
    }catch{if(!res.headersSent)res.writeHead(404);res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  return {url:`http://127.0.0.1:${server.address().port}${prefix}`,title:String(project.title||path.basename(directory)),close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections()})};
}
module.exports={readSceneConfig,fencedFile,createSceneServer,createMediaServer:entry=>require('./wallpaper/media-server.cjs').createMediaServer(entry)};
