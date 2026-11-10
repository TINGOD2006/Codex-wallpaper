// The attached mode follows an observed host lifetime; it never launches a host.
function createAttachedLifetime({stop,clock={setTimeout,clearTimeout},graceMs=4000}){
 let seen=false,timer=null,closed=false;
 function cancel(){if(timer!==null)clock.clearTimeout(timer);timer=null}
 return {observe(state){
  if(closed)return;
  const running=state.hosts?.some(h=>h.id==='codex-desktop'&&h.running);
  if(running)seen=true;
  // Host scans publish before reconciliation. Wait for an idle reconciled state,
  // and never race a requested handoff or a new launch in progress.
  const idle=seen&&!running&&!state.pendingLaunch&&['idle','disabled'].includes(state.phase);
  if(!idle){cancel();return}
  if(timer===null)timer=clock.setTimeout(()=>{timer=null;closed=true;Promise.resolve().then(stop).catch(()=>{})},graceMs);
 },close(){closed=true;cancel()}};
}
module.exports={createAttachedLifetime};
