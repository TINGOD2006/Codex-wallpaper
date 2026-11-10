const fs=require('node:fs/promises'),path=require('node:path');
const {readJson,atomicJson}=require('../config.cjs'),{consumeCommands,delay}=require('../control.cjs'),{WindowMonitor}=require('../window-monitor.cjs');
const {createWallpaperRuntime}=require('./runtime.cjs');
const {captureLegacyStatus}=require('./migration.cjs');
function alive(pid){try{process.kill(pid,0);return true}catch(e){return e.code==='EPERM'}}
async function runDaemon(file,{connectManaged}){
 const identity=await readJson(file),projectRoot=path.resolve(__dirname,'../..'),stateRoot=path.join(projectRoot,'.state'),statusPath=path.join(stateRoot,'status.json'),monitor=new WindowMonitor(file);
 let client,runtime,quitting=false,reloaded=false,retries=0,last={state:'disconnected',layout:'unknown',enabled:false,panelReady:false};
 const publish=async extra=>{await atomicJson(statusPath,{sessionId:identity.sessionId,daemonPid:process.pid,appPid:identity.pid,mode:identity.mode,appVersion:identity.appVersion,...runtime?.status()||last,...extra,updatedAt:new Date().toISOString()})};
 const stop=()=>{quitting=true};process.on('SIGTERM',stop);process.on('SIGINT',stop);await captureLegacyStatus({projectRoot,dataRoot:path.join(stateRoot,'wallpaper')});await publish();
 try{
  while(!quitting){
   if((await readJson(file)).sessionId!==identity.sessionId||!alive(identity.pid))break;
   await consumeCommands(stateRoot,identity.sessionId,async action=>{if(!runtime)throw new Error('Wallpaper panel is not ready');const result=await runtime.action(action);await publish();return result});
   if(!client?.connected){
    await runtime?.close();runtime=null;client?.close();last={state:'disconnected',layout:'unknown',enabled:false,panelReady:false};
    if(retries>=5){await publish({reason:'Reconnect limit reached; use Start to retry'});break}
    try{retries++;({client}=await connectManaged(file));client.on('notification',e=>{if(e.method==='Page.frameNavigated'&&!e.params.frame.parentId)reloaded=true});retries=0}catch(e){await publish({reason:e.message});await delay(Math.min(4000,250*2**(retries-1)));continue}
   }
   try{
    if(reloaded){await runtime?.close();runtime=null;reloaded=false}
    if(!runtime)runtime=await createWallpaperRuntime({client,identity,projectRoot,windowVisible:()=>monitor.visible});else await runtime.refresh();
    await publish();
   }catch(e){
    if(e.code==='UNSUPPORTED_LAYOUT'||e.message==='Wallpaper panel needs remount'){await runtime?.close();runtime=null}
    last={state:e.code==='UNSUPPORTED_LAYOUT'?'unsupported':'error',layout:'unknown',enabled:false,panelReady:false,reason:e.message};await publish({reason:e.message});
   }
   await delay(750);
  }
 }finally{const result=await runtime?.close();monitor.close();await publish({state:result?.restored?'disabled':client?.connected?'stopped':'restore-unconfirmed',panelReady:false,uiTogglePresent:false,reason:result?.error||'Wallpaper loader stopped'});client?.close();process.off('SIGTERM',stop);process.off('SIGINT',stop)}
}
module.exports={runDaemon};
