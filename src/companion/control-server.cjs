const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const {atomicJson}=require('../config.cjs'),{errorInfo}=require('./status.cjs'),{exportDiagnostics}=require('./diagnostics.cjs');
const {FULL_WINDOW_MATERIALS}=require('../wallpaper/styles.cjs');
const run=promisify(execFile);let processIdentity;
const exact=(p,keys)=>p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).length===keys.length&&keys.every(k=>Object.hasOwn(p,k));
function matchesToken(header,expected){const a=Buffer.from(header?.startsWith('Bearer ')?header.slice(7):''),b=Buffer.from(expected);return a.length===b.length&&crypto.timingSafeEqual(a,b)}
async function nativeProtect(folder){await run(process.env.MIKU_PWSH||'pwsh',['-NoProfile','-File',path.resolve(__dirname,'../../scripts/companion-security.ps1'),'-Operation','Protect','-TargetPath',folder],{windowsHide:true,timeout:30000})}
async function identity(){if(!processIdentity)processIdentity=run(process.env.MIKU_PWSH||'pwsh',['-NoProfile','-File',path.resolve(__dirname,'../../scripts/companion-security.ps1'),'-Operation','Stamp','-ManagerPid',String(process.pid)],{windowsHide:true,timeout:10000}).then(r=>JSON.parse(r.stdout));return processIdentity}
async function startControlServer({paths,supervisor,appearance,recoverEntry=async()=>{},showWindow=async()=>{},onExit=async()=>{},protect=nativeProtect}){
 await fs.mkdir(paths.runtime,{recursive:true});const [,stamp]=await Promise.all([protect(paths.runtime),identity()]);
 const token=crypto.randomBytes(32).toString('hex'),nonces=new Map(),sessions=new Map(),cache=new Map(),sequences=new Map();let address,closed=false;
 const send=(res,status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(data))};
 const publicState=()=>({...supervisor.snapshot(),rendering:appearance.rendering?.()||null});
 async function execute(action,p){
  switch(action){
   case 'status':case 'view':if(!exact(p,[]))throw new Error('Invalid payload');return action==='view'?{...await appearance.view(),fullWindowMaterials:FULL_WINDOW_MATERIALS}:undefined;
   case 'enable-wallpaper':if(!exact(p,[]))throw new Error('Invalid enable request');await supervisor.enableWallpaper();break;
   case 'set-enabled':if(!exact(p,['enabled'])||typeof p.enabled!=='boolean')throw new Error('Invalid enabled');await supervisor.setEnabled(p.enabled);break;
   case 'reconnect':if(!exact(p,[]))throw new Error('Invalid payload');await supervisor.reconnect();await recoverEntry();break;
   case 'launch':case 'wait-for-exit-and-launch':if(!exact(p,['hostId'])||!['codex-desktop','chatgpt-desktop'].includes(p.hostId))throw new Error('Invalid host');await supervisor[action==='launch'?'launch':'waitForExitAndLaunch'](p.hostId);break;
   case 'appearance.command':if(!exact(p,['command']))throw new Error('Invalid payload');return appearance.dispatch(p.command);
   case 'show-window':if(!exact(p,[]))throw new Error('Invalid payload');await showWindow(issueBootstrap());return {shown:true};
   case 'panel-link':if(!exact(p,[]))throw new Error('Invalid payload');return {url:issueBootstrap()};
   case 'sidebar-link':if(!exact(p,[]))throw new Error('Invalid payload');return {url:issueBootstrap('/sidebar')};
   case 'caption-host':if(!exact(p,[]))throw new Error('Invalid payload');return {host:supervisor.captionHost()};
   case 'export-diagnostics':if(!exact(p,[]))throw new Error('Invalid payload');return exportDiagnostics({state:publicState(),versions:{manager:require('../../package.json').version},paths});
   case 'exit':if(!exact(p,[]))throw new Error('Invalid payload');await onExit();return {exiting:true};
   default:throw new Error('Unknown command');
  }
 }
 async function body(req){const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>65536)throw Object.assign(new Error('Request too large'),{status:413});chunks.push(chunk)}return JSON.parse(Buffer.concat(chunks).toString('utf8'))}
 const server=http.createServer(async(req,res)=>{
  try{
   if(closed)return send(res,503,{error:{message:'Manager offline'}});
   if(req.headers.host!==new URL(address).host||req.headers.origin&&req.headers.origin!==address)return send(res,403,{error:{message:'Origin rejected'}});
   const pathname=new URL(req.url,address).pathname;
   if(pathname==='/api/session'&&req.method==='POST'){
    if(req.headers.origin!==address)return send(res,403,{error:{message:'Origin rejected'}});
    const p=await body(req),expires=nonces.get(p.nonce);nonces.delete(p.nonce);if(!expires||expires<Date.now())return send(res,401,{error:{message:'Bootstrap expired'}});
    const session=crypto.randomBytes(32).toString('hex');sessions.set(session,Date.now()+12*3600000);if(sessions.size>16)sessions.delete(sessions.keys().next().value);
    return send(res,200,{ok:true},{'Set-Cookie':`cw_session=${session}; HttpOnly; SameSite=Strict; Path=/`});
   }
   if(pathname.startsWith('/api/')){
    const bearer=matchesToken(req.headers.authorization,token),cookie=req.headers.cookie?.match(/(?:^|;\s*)cw_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    if(!bearer&&(!cookie||sessions.get(cookie)<Date.now()||!sessions.has(cookie)))return send(res,401,{error:{message:'Authentication required'}});
    if(!bearer&&req.method==='POST'&&req.headers.origin!==address)return send(res,403,{error:{message:'Origin required'}});
    if(pathname==='/api/status'&&req.method==='GET')return send(res,200,{ok:true,state:publicState()});
    if(pathname!=='/api/command'||req.method!=='POST')return send(res,405,{error:{message:'Method rejected'}});
    if(!req.headers['content-type']?.startsWith('application/json'))return send(res,415,{error:{message:'JSON required'}});
    const command=await body(req),requestMatch=typeof command.requestId==='string'&&command.requestId.match(/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})-([1-9][0-9]{0,14})$/);if(!exact(command,['requestId','action','payload'])||!requestMatch||!Number.isSafeInteger(Number(requestMatch[2]))||typeof command.action!=='string')return send(res,400,{error:{message:'Invalid command'}});
    const fingerprint=JSON.stringify(command),previous=cache.get(command.requestId);if(previous&&previous.fingerprint!==fingerprint)return send(res,409,{error:{message:'Request identity reused'}});
    if(!previous){let window=sequences.get(requestMatch[1]);const sequence=Number(requestMatch[2]);if(!window){if(sequences.size>=1024)return send(res,429,{error:{message:'Too many clients'}});window={max:0,seen:new Set()};sequences.set(requestMatch[1],window)}if(sequence<=window.max-256||window.seen.has(sequence))return send(res,409,{error:{message:'Expired request'}});window.max=Math.max(window.max,sequence);window.seen.add(sequence);for(const n of window.seen)if(n<=window.max-256)window.seen.delete(n)}
    if(!previous){const promise=execute(command.action,command.payload).then(result=>({ok:true,state:publicState(),result})).catch(error=>({ok:false,state:publicState(),error:errorInfo(error.code||'SETTINGS_INVALID','control')}));cache.set(command.requestId,{fingerprint,promise});if(cache.size>256)cache.delete(cache.keys().next().value)}
    const reply=await cache.get(command.requestId).promise;return send(res,reply.ok?200:400,reply);
   }
   const assets={'/':'dashboard.html','/dashboard.js':'dashboard.js','/dashboard.css':'dashboard.css','/sidebar':'sidebar.html','/sidebar.js':'sidebar.js','/sidebar-recovery.js':'sidebar-recovery.js','/sidebar.css':'sidebar.css','/panel-dom.js':'../wallpaper/panel-dom.js','/panel.css':'../wallpaper/panel.css'};
   if(req.method!=='GET'||!Object.hasOwn(assets,pathname))return send(res,404,{error:{message:'Not found'}});
   const asset=assets[pathname],data=await fs.readFile(path.join(__dirname,asset)),type=asset.endsWith('.js')?'text/javascript':asset.endsWith('.css')?'text/css':'text/html';
   res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"});res.end(data);
  }catch(e){send(res,e.status||400,{ok:false,error:{message:'Request rejected'}})}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});address=`http://127.0.0.1:${server.address().port}`;
 let descriptor;const file=path.join(paths.runtime,'manager.json');try{descriptor={...stamp,schemaVersion:1,instanceId:supervisor.instanceId,host:'127.0.0.1',port:server.address().port,token,entryFile:path.resolve(process.argv[1])};await atomicJson(file,descriptor)}catch(e){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));throw e}
 function issueBootstrap(route='/'){if(!['/','/sidebar'].includes(route))throw new Error('Invalid view');const nonce=crypto.randomBytes(24).toString('hex');nonces.set(nonce,Date.now()+60000);if(nonces.size>16)nonces.delete(nonces.keys().next().value);return address+route+'#'+nonce}
 return {descriptor,address,issueBootstrap,async close(){if(closed)return;closed=true;nonces.clear();sessions.clear();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));try{const value=JSON.parse(await fs.readFile(file,'utf8'));if(value.instanceId===descriptor.instanceId)await fs.unlink(file)}catch(e){if(e.code!=='ENOENT')throw e}}};
}
module.exports={startControlServer,matchesToken};
