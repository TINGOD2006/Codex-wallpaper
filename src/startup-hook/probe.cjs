// Qualification-only payload. It cannot apply styles, read text, or change app settings.
function register({app,BrowserWindow,report,nodePath}){
 let disposed=false,started=false;const seen=new Set();
 const record=(event,details={})=>{try{report(event,details)}catch{}};
 const guarded=fn=>(...args)=>{try{Promise.resolve(fn(...args)).catch(()=>record('HOOK_RUNTIME_UNSUPPORTED'))}catch{record('HOOK_RUNTIME_UNSUPPORTED')}};
 async function inspect(window){
  if(disposed||seen.has(window.id))return;seen.add(window.id);
  const wc=window.webContents,handle=window.getNativeWindowHandle?.();
  record('WINDOW_API',{windowId:window.id,webContentsId:wc?.id,handleSupported:Buffer.isBuffer(handle)&&handle.length>0,executeSupported:typeof wc?.executeJavaScript==='function'});
  if(!wc||typeof wc.executeJavaScript!=='function')return;
  const check=guarded(async()=>{if(disposed||wc.isDestroyed())return;const value=await wc.executeJavaScript('({root:!!document.documentElement,frameCount:document.querySelectorAll("[data-app-shell-frame]").length})',false);record('DOCUMENT_API',{root:value?.root===true,frameCount:Number.isSafeInteger(value?.frameCount)?value.frameCount:-1})});
  wc.once('did-finish-load',check);if(!wc.isLoading())await check();
 }
 async function platform(){
  if(disposed||started)return;started=true;
  const http=require('node:http');const server=http.createServer((_req,res)=>res.end('cw-probe'));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});await new Promise(resolve=>server.close(resolve));record('HTTP_API',{supported:true});
  const {execFile}=require('node:child_process');await new Promise((resolve,reject)=>execFile(nodePath,['-e','process.stdout.write("cw-probe")'],{windowsHide:true,timeout:5000,maxBuffer:1024},(e,out)=>e?reject(e):out==='cw-probe'?resolve():reject(Error('probe'))));record('CHILD_API',{supported:true});
 }
 const created=guarded((_event,window)=>inspect(window));app.on('browser-window-created',created);
 app.whenReady().then(guarded(async()=>{record('APP_READY');for(const w of BrowserWindow.getAllWindows())await inspect(w);await platform()})).catch(()=>record('HOOK_RUNTIME_UNSUPPORTED'));
 record('HOOK_REGISTERED');
 return {dispose(){disposed=true;app.removeListener('browser-window-created',created)}};
}
module.exports={register};
