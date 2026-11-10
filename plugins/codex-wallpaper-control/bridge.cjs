const path=require('node:path'),fs=require('node:fs/promises'),{execFile}=require('node:child_process'),{promisify}=require('node:util'),{randomUUID}=require('node:crypto');
const {resolvePaths}=require('../../src/companion/paths.cjs'),{connectCompanion}=require('../../src/companion/control-client.cjs');
const run=promisify(execFile);
function connectionError(error){
 const messages={COMPANION_NOT_STARTED:'尚未找到桌布背景程序的連線紀錄。',COMPANION_UNREACHABLE:'桌布背景程序沒有回應，請重新啟動桌布功能。',COMPANION_IDENTITY_UNVERIFIED:'無法確認桌布背景程序身分，已停止連線；可能是舊紀錄或系統查詢失敗。',COMPANION_CONNECTION_FAILED:'桌布連線檢查失敗，請重試或查看診斷。'};
 const reason=error?.cause?.code||error?.code,code=reason==='ENOENT'?'COMPANION_NOT_STARTED':['ECONNREFUSED','ECONNRESET','ETIMEDOUT','TimeoutError'].includes(reason)||error?.name==='TimeoutError'?'COMPANION_UNREACHABLE':reason==='COMPANION_IDENTITY_UNVERIFIED'?reason:'COMPANION_CONNECTION_FAILED';
 return {code,message:messages[code],stage:'control',retryable:true};
}
function offline(){return {schemaVersion:1,instanceId:null,revision:0,phase:'offline',desired:{enabled:false},observed:{applied:false,connected:false,hostId:null,appVersion:null,generation:0,adapterId:null,adapterVersion:null,compatibility:null,heartbeatAt:null,confirmedAt:null,regions:{}},playback:{state:'off'},error:null}}
async function launchManager(paths){const script=path.join(paths.app,'scripts/start-companion.ps1');try{await fs.access(script)}catch{throw Object.assign(new Error('請先安裝獨立桌布管理器。'),{code:'RUNTIME_MISSING'})}await run(process.env.MIKU_PWSH||'pwsh',['-NoProfile','-File',script,'-Action','Show'],{windowsHide:true,timeout:60000,maxBuffer:65536})}
function createPluginBridge({paths=resolvePaths(),startManager=()=>launchManager(paths),connect=()=>connectCompanion({paths})}={}){
 let client=null,sequence=0;const panelId='mcp-'+randomUUID();
 async function connection(){if(!client)client=await connect();return client}
 async function request(action,payload={}){try{return await(await connection()).request(action,payload)}catch(e){client?.close();client=null;throw e}}
 async function status(){try{return(await request('status')).state}catch(error){return {...offline(),error:connectionError(error)}}}
 async function ensure(){try{await connection()}catch{await startManager();client=null;await connection()}}
 return {status,request,
  async openManager(){await startManager();client=null;return(await request('status')).state},
  async setEnabled(enabled){await ensure();return(await request('set-enabled',{enabled})).state},
  async setSettings(patch){await ensure();const state=await status(),reply=await request('appearance.command',{command:{sessionId:state.instanceId,panelId,seq:++sequence,action:'settings.patch',payload:{patch}}});if(!reply.result?.ok)throw Object.assign(new Error('設定未通過檢查。'),{code:'SETTINGS_INVALID'});return(await request('status')).state},
  async reconnect(){await ensure();return(await request('reconnect')).state},
  async exportDiagnostics(){return request('export-diagnostics')},
  close(){client?.close();client=null}
 };
}
module.exports={createPluginBridge,offline};
