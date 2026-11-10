const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {createReadStream}=require('node:fs'),{randomUUID}=require('node:crypto');
const projectRoot=path.resolve(__dirname,'../..');
const {parseRange}=require('../renderer/resource-http.cjs');
async function createMediaServer(entry){
  if(entry.kind==='scene')return require('../scene-server.cjs').createSceneServer({wallpaperDirectory:entry.directory});
  if(!['video','image'].includes(entry.kind))throw new Error('Unsupported wallpaper media');
  const directory=await fs.realpath(entry.directory),file=await fs.realpath(entry.mediaPath),stat=await fs.stat(file);
  if(!file.toLowerCase().startsWith(directory.toLowerCase()+path.sep)||!stat.isFile()||stat.size>(entry.kind==='video'?1024**3:10*1024**2))throw new Error('Invalid media resource');
  const extension=path.extname(file).toLowerCase(),mediaName='media'+extension;
  const mime={'.mp4':'video/mp4','.m4v':'video/mp4','.mov':'video/quicktime','.webm':'video/webm','.mkv':'video/x-matroska','.ogv':'video/ogg','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'}[extension];
  if(!mime)throw new Error('Unsupported media container');
  const prefix='/'+randomUUID()+'/';
  const server=http.createServer(async(req,res)=>{
    try{
      if(req.headers.host!==`127.0.0.1:${server.address().port}`){res.writeHead(403);res.end();return}
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return}
      const pathname=new URL(req.url,'http://127.0.0.1').pathname;if(!pathname.startsWith(prefix)){res.writeHead(404);res.end();return}
      const name=decodeURIComponent(pathname.slice(prefix.length));
      res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
      res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' blob:; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'");
      if(name==='project.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({type:entry.kind,file:mediaName,title:entry.title}));return}
      if(name===mediaName){
        res.setHeader('Content-Type',mime);res.setHeader('Accept-Ranges','bytes');let start=0,end=stat.size-1;
        if(req.headers.range){
          const range=parseRange(req.headers.range,stat.size);if(!range){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});res.end();return}({start,end}=range);
          res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${stat.size}`);
        }
        res.setHeader('Content-Length',Math.max(0,end-start+1));if(req.method==='HEAD'||stat.size===0){res.end();return}
        const stream=createReadStream(file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);return;
      }
      const files={'': ['src/scene-renderer/index.html','text/html'],'index.html':['src/scene-renderer/index.html','text/html'],'renderer.js':['src/scene-renderer/renderer.js','text/javascript'],'engine.js':['assets/webwallgl/webwallgl.global.min.js','text/javascript']};
      const asset=files[name];if(!asset){res.writeHead(404);res.end();return}const content=await fs.readFile(path.join(projectRoot,asset[0]));res.setHeader('Content-Type',asset[1]);res.setHeader('Content-Length',content.length);res.end(req.method==='HEAD'?undefined:content);
    }catch{if(!res.headersSent)res.writeHead(404);res.end()}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  return {url:`http://127.0.0.1:${server.address().port}${prefix}`,title:entry.title,close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections()})};
}
module.exports={createMediaServer};
