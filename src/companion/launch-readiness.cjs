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
   try{return await connect({paths,statusTimeoutMs:2000,signal:AbortSignal.timeout(Math.max(1,deadline-now()))})}catch(error){lastError=error}
  }
  if(now()<deadline)await delay(Math.min(200,deadline-now()));
 }
 throw Object.assign(new Error('桌布服務初始化逾時，請查看啟動診斷。'),{code:'COMPANION_START_TIMEOUT',cause:lastError});
}
async function launchAndWait(client,{timeoutMs=1500,now=Date.now,delay=sleep}={}){
 const deadline=now()+timeoutMs;
 const request=action=>client.request(action,{}, {timeoutMs:Math.max(1,deadline-now())});
 let reply=client.initial||await request('status');
 if(reply.state.observed?.connected)return reply;
 try{
  // Native startup has already been requested. This only wakes passive attachment.
  if(!['connecting','checking'].includes(reply.state.phase)&&now()<deadline)reply=await request('attach-existing');
  while(pending(reply.state)&&now()<deadline){
   await delay(Math.min(250,deadline-now()));
   if(now()<deadline)reply=await request('status');
  }
 }catch(error){if(error.name!=='TimeoutError')throw error}
 return reply;
}
module.exports={waitForCompanion,launchAndWait};
