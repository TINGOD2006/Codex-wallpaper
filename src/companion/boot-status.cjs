const fs=require('node:fs/promises'),path=require('node:path');
const {connectCompanion}=require('./control-client.cjs'),{resolvePaths}=require('./paths.cjs'),{atomicJson}=require('../config.cjs');
function sessionState(launchId,state,host){
 const off=state.desired?.enabled===false||state.desired?.wallpaperEnabled===false;
 return {LaunchId:launchId,HostPid:Number.isInteger(host?.pid)?host.pid:0,HostStartTime:String(host?.startTime||''),HostPath:host?.appPath||'',Ready:!!(host&&!state.observed?.hostUnresponsive&&(state.observed?.applied||off&&state.observed?.connected)),Failed:!!(state.error&&!['HOST_ENDPOINT_PENDING','HOST_SHELL_PENDING','HOST_LAUNCH_FAILED','HOST_IDENTITY_CHANGED','HOST_UNRESPONSIVE'].includes(state.error.code)&&!state.observed?.applied)};
}
async function feedBootStatus({paths,statePath,launchId,playerPid,connect=connectCompanion,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),alive=pid=>{try{process.kill(pid,0);return true}catch{return false}},write=atomicJson,read=fs.readFile,timeoutMs=45000}){
 const directory=path.join(paths.runtime,'boot-animation'),expected=path.join(directory,launchId+'.json');
 if(!/^[a-f0-9-]{36}$/i.test(launchId)||path.resolve(statePath)!==path.resolve(expected)||!Number.isInteger(playerPid)||playerPid<=0)throw Error('Invalid animation scope');
 const deadline=now()+timeoutMs;let client,lastDescriptor='',nextConnect=0,lastState='';
 try{while(now()<deadline&&alive(playerPid)){
  try{const result=JSON.parse(await read(statePath+'.result.json','utf8'));if(result.launchId===launchId)break}catch{}
  try{
   if(!client){const descriptor=await read(path.join(paths.runtime,'manager.json'),'utf8');if(descriptor!==lastDescriptor||now()>=nextConnect){lastDescriptor=descriptor;nextConnect=now()+2000;client=await connect({paths,statusTimeoutMs:2000})}}
   if(client){const reply=await client.request('caption-host',{}, {timeoutMs:2000}),value=sessionState(launchId,reply.state,reply.result.host),key=JSON.stringify(value);if(key!==lastState){await write(statePath,value);lastState=key}}
  }catch{client?.close();client=null}
  await sleep(250);
 }}finally{client?.close()}
}
if(require.main===module){const args=process.argv.slice(2),get=name=>args[args.indexOf(name)+1];feedBootStatus({paths:resolvePaths(),statePath:get('--state-file'),launchId:get('--launch-id'),playerPid:Number(get('--player-pid'))}).catch(()=>{process.exitCode=1})}
module.exports={sessionState,feedBootStatus};
