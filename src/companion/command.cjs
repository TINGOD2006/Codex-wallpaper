const {randomUUID}=require('node:crypto'),{resolvePaths}=require('./paths.cjs'),{connectCompanion}=require('./control-client.cjs');
async function main(){
 const [action,...args]=process.argv.slice(2);
 if(!['status','wait-ready','show-window','exit','set-enabled','patch-reading','reconnect','launch','wait-for-exit-and-launch'].includes(action))throw new Error('Invalid companion action');
 const rootAt=args.indexOf('--root'),installRoot=rootAt>=0?args[rootAt+1]:undefined,paths=resolvePaths({installRoot});
 const {waitForCompanion,launchAndWait}=require('./launch-readiness.cjs');
 const settle=action==='wait-ready'&&args.includes('--settle-launch')||action==='launch'&&args.includes('--settle');
 const client=await (action==='wait-ready'?waitForCompanion({paths}):connectCompanion({paths,statusTimeoutMs:settle?1500:undefined}));
 try{
  if(settle)return await launchAndWait(client);
  if(['status','wait-ready'].includes(action))return client.initial;
  if(action==='patch-reading'){
   const reading={};
   for(const [flag,key]of [['--scrim','scrim'],['--x','x']])if(args.includes(flag)){const value=Number(args[args.indexOf(flag)+1]);if(!Number.isFinite(value))throw new Error('Invalid reading value');reading[key]=value}
   return await client.request('appearance.command',{command:{sessionId:client.initial.state.instanceId,panelId:'cli-'+randomUUID(),seq:1,action:'settings.patch',payload:{patch:{reading}}}});
  }
  return await client.request(action,action==='set-enabled'?{enabled:args.includes('--enabled')}:['launch','wait-for-exit-and-launch'].includes(action)?{hostId:'codex-desktop'}:{});
 }finally{client.close()}
}
// Windows launchers can inherit a legacy console code page. Keep the wire JSON ASCII.
function encodeReply(value){return JSON.stringify(value).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'))+'\n'}
if(require.main===module)main().then(value=>process.stdout.write(encodeReply(value))).catch(()=>{process.stderr.write('MANAGER_OFFLINE\n');process.exitCode=2});
module.exports={main,encodeReply};
