'use strict';
(function(root){
 function view(state,busy=false){
  const waiting=state.pendingLaunch===true,off=state.desired?.enabled===false||state.desired?.wallpaperEnabled===false,applied=state.observed?.applied===true&&!off;
  const needsLaunch=state.error?.code==='HOST_NEEDS_MANAGED_LAUNCH';
  const preview=state.playback?.preview===true,previewError=preview&&!!state.error;
  const fallback=!!state.fallback||preview&&applied;
  let message=state.error?.message||({disabled:'桌布已關閉。',connecting:'正在連線…',checking:'正在檢查背景接入…'}[state.phase])||'設定可儲存，背景尚未套用。';
  if(off)message=state.desired?.enabled===false?'桌布總開關已關閉。':'背景開關已關閉，其他介面設定仍啟用。';
  else if(waiting)message='已安排接回：請儲存工作並正常完全退出 Codex，桌布服務會自動重新開啟。';
  else if(fallback){
   message=state.error?(state.error.code==='RENDERER_FAILED'?'動態載入失敗。':state.error.message||'桌布接入暫未完成。')+' 已保留靜態背景。':applied?'靜態背景已顯示，正在預載動態場景…':'已顯示快取的靜態背景，正在接入桌布…';
  }else if(applied)message='背景已套用'+(Number.isFinite(state.rendering?.decodedFps)?` · 畫面 ${state.rendering.decodedFps} FPS`:'');
  return {message,warning:!applied||previewError,action:off?'enable-wallpaper':needsLaunch?'wait-for-exit-and-launch':'reconnect',label:busy?'處理中…':off?'啟用桌布':waiting?'等待正常退出':needsLaunch?'退出後自動接回':'重試連線',disabled:busy||waiting,visible:!applied||previewError};
 }
 function create({request,update}){
  let state={},busy=false,error='';
  const publish=()=>update({...view(state,busy),operationError:error});
  return {setState(next){state=next;publish()},async run(){const current=view(state,busy);if(current.disabled||!current.visible)return;busy=true;error='';publish();try{const reply=await request(current.action,current.action==='wait-for-exit-and-launch'?{hostId:'codex-desktop'}:{});state=reply.state}catch{error='操作未完成，請重試；若服務已離線，請先恢復桌布服務。'}finally{busy=false;publish()}}};
 }
 const api={view,create};if(typeof module==='object'&&module.exports)module.exports=api;else root.wallpaperRecovery=api;
})(globalThis);
