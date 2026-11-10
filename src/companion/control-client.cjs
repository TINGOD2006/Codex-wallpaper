const fs=require('node:fs/promises'),path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util'),{randomUUID}=require('node:crypto');
const run=promisify(execFile);
async function verifyManager(descriptor,paths){
 const entries=['src/companion/main.cjs','dist/companion.cjs'].map(name=>path.join(paths.app,name).toLowerCase());
 if(!entries.includes(path.resolve(descriptor.entryFile||'').toLowerCase()))throw new Error('Untrusted manager entry');
 await run(process.env.MIKU_PWSH||'pwsh',['-NoProfile','-File',path.resolve(__dirname,'../../scripts/companion-security.ps1'),'-Operation','Verify','-ManagerPid',String(descriptor.pid),'-StartTime',descriptor.startTime,'-ExpectedEntry',descriptor.entryFile,'-ExpectedNode',descriptor.nodePath],{windowsHide:true,timeout:10000});return true;
}
async function connectCompanion({paths,verifyProcess=verifyManager}){
 const text=await fs.readFile(path.join(paths.runtime,'manager.json'),'utf8');if(text.length>8192)throw new Error('Invalid manager descriptor');const d=JSON.parse(text);
 if(d.host!=='127.0.0.1'||!Number.isInteger(d.port)||d.port<1||d.port>65535||!/^[a-f0-9]{64}$/.test(d.token)||!Number.isInteger(d.pid)||typeof d.startTime!=='string'||typeof d.instanceId!=='string')throw new Error('Invalid manager descriptor');
 try{if(await verifyProcess(d,paths)!==true)throw new Error('Manager identity mismatch')}catch{throw Object.assign(new Error('Manager identity unverified'),{code:'COMPANION_IDENTITY_UNVERIFIED'})}const address=`http://127.0.0.1:${d.port}`,clientId=randomUUID();let sequence=0;
 async function request(action,payload={}){const response=await fetch(address+'/api/command',{method:'POST',headers:{Authorization:'Bearer '+d.token,'Content-Type':'application/json'},body:JSON.stringify({requestId:clientId+'-'+(++sequence),action,payload}),signal:AbortSignal.timeout(60000)});const reply=await response.json();if(!response.ok||reply.state?.instanceId!==d.instanceId)throw Object.assign(new Error(reply.error?.message||'Manager unavailable'),{code:reply.error?.code});return reply}
 await request('status');return {request,close(){}};
}
module.exports={connectCompanion,verifyManager};
