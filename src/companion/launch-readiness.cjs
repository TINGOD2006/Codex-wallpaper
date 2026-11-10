const fs=require('node:fs/promises'),path=require('node:path');
const {connectCompanion}=require('./control-client.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const pending=state=>['connecting','checking'].includes(state.phase)||['HOST_ENDPOINT_PENDING','HOST_LAUNCH_FAILED','HOST_IDENTITY_CHANGED'].includes(state.error?.code);
async function waitForCompanion({paths,timeoutMs=30000,connect=connectCompanion,read=fs.readFile,now=Date.now,delay=sleep}={}){
 const deadline=now()+timeoutMs;let lastDescriptor=null,nextAttempt=0,lastError;
 while(now()<deadline){
  let descriptor;try{descriptor=await read(path.join(paths.runtime,'manager.json'),'utf8')}catch(error){if(error.code!=='ENOENT')throw error;await delay(200);continue}
  if(descriptor!==lastDescriptor||now()>=nextAttempt){
   lastDescriptor=descriptor;nextAttempt=now()+2000;
   try{return await connect({paths})}catch(error){lastError=error}
  }
  await delay(200);
 }
 throw Object.assign(new Error('桌布服務初始化逾時，請查看啟動診斷。'),{code:'COMPANION_START_TIMEOUT',cause:lastError});
}
async function launchAndWait(client,{timeoutMs=10000,now=Date.now,delay=sleep}={}){
 let reply=await client.request('status'),deadline=now()+timeoutMs;
 while(!reply.state.hosts?.some(h=>h.id==='codex-desktop')&&now()<deadline){await delay(200);reply=await client.request('status')}
 if(!reply.state.hosts?.some(h=>h.id==='codex-desktop'))throw Object.assign(new Error('找不到官方 Codex 安裝。'),{code:'HOST_NOT_FOUND'});
 // The clicked PowerShell process already restored the native window. Do not
 // spawn another activation verifier when this host is already connected.
 if(!reply.state.observed?.connected&&!pending(reply.state))reply=await client.request('launch',{hostId:'codex-desktop'});
 while(pending(reply.state)&&now()<deadline){await delay(500);reply=await client.request('status')}
 return reply;
}
module.exports={waitForCompanion,launchAndWait};
