'use strict';
const managerClientId=crypto.randomUUID();let managerSequence=0,managerState=null,managerPolling=false;
const phaseNames={idle:'等待宿主',offline:'管理器離線',connecting:'正在連線',checking:'正在確認套用',active:'已套用',partial:'部分區域可用',paused:'已套用・播放暫停',disabled:'已停用',incompatible:'不相容',error:'發生錯誤','needs-launch':'需要由管理器啟動'};
function renderCompanionState(state){
 managerState=state;document.body.dataset.phase=state.phase;document.querySelector('[data-host-status]').textContent=phaseNames[state.phase]||'正在確認';
 const entry=document.querySelector('[data-entry-state]');if(entry){entry.textContent=state.entry?.error==='CAPTION_BOUNDS_UNAVAILABLE'?'右上角入口：無法核對視窗按鈕位置，已停止貼附。':state.entry?.error?'右上角入口：啟動失敗，請檢查WebView2並重新開啟管理器。':state.entry?.state==='ready'?'右上角 Wallpaper 按鈕已貼附。':state.entry?.state==='hidden'?'右上角入口：等待切回Codex視窗。':''}
 document.querySelector('[data-host-version]').textContent=state.observed?.appVersion?'宿主版本 '+state.observed.appVersion+(state.observed.compatibility==='structural'?' · 結構相容，未列為人工驗證版本':''):'尚未確認宿主版本';
 let metric=document.querySelector('[data-render-state]');if(!metric){metric=document.createElement('small');metric.dataset.renderState='';document.querySelector('[data-host-version]').after(metric)}const rendering=state.rendering;metric.textContent=rendering?[rendering.backend==='pool'?'共用渲染':rendering.backend==='isolated'?'獨立渲染':rendering.backend==='image'?'靜態圖片':'',rendering.outputSize?`${rendering.outputSize.width} × ${rendering.outputSize.height}`:'',Number.isFinite(rendering.decodedFps)?`畫面 ${rendering.decodedFps} FPS`:''].filter(Boolean).join(' · '):'';
 document.querySelector('[data-error-code]').textContent=state.error?.code||'';document.querySelector('[data-error-message]').textContent=state.error?.message||'';
 const waiting=document.querySelector('[data-action="wait-for-exit-and-launch"]');waiting.textContent=state.pendingLaunch?'正在等待正常退出':'退出後自動接回';waiting.disabled=!!state.pendingLaunch||state.phase==='offline';
 document.querySelector('[data-action="set-enabled"]').textContent=state.desired?.enabled?'停用客製化':'啟用客製化';
}
async function managerRequest(action,payload={}){
 const response=await fetch('/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:managerClientId+'-'+(++managerSequence),action,payload})});
 const reply=await response.json();if(reply.state)renderCompanionState(reply.state);if(!response.ok||!reply.ok)throw new Error(reply.error?.message||'操作失敗');return reply;
}
window.renderCompanionState=renderCompanionState;
window.managerPanelCommand=async text=>{
 const command=JSON.parse(text);try{const reply=await managerRequest('appearance.command',{command});window.__codexWallpaperPanel.receive(reply.result)}catch(e){window.__codexWallpaperPanel?.receive({...command,ok:false,error:e.message})}
};
async function poll(){if(managerPolling)return;managerPolling=true;try{const response=await fetch('/api/status');if(!response.ok)throw new Error('offline');const reply=await response.json();renderCompanionState(reply.state);const view=await managerRequest('view');window.__codexWallpaperPanel?.update(view.result)}catch{renderCompanionState({phase:'offline',observed:{applied:false},error:{message:'無法連線到管理器。請從系統匣或啟動入口重新開啟。'}})}finally{managerPolling=false}}
async function boot(){
 const nonce=location.hash.slice(1);history.replaceState(null,'',location.pathname);if(nonce){const response=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nonce})});if(!response.ok)throw new Error('啟動連線已過期，請從系統匣重新開啟。')}
 const reply=await managerRequest('view');mountWallpaperPanel({sessionId:reply.state.instanceId,panelId:crypto.randomUUID(),binding:'managerPanelCommand',css:'',fullWindowMaterials:reply.result.fullWindowMaterials});window.__codexWallpaperPanel.update(reply.result);document.getElementById('codex-wallpaper-button').click();
 for(const button of document.querySelectorAll('[data-action]'))button.addEventListener('click',async()=>{button.disabled=true;try{const action=button.dataset.action,payload=action==='set-enabled'?{enabled:!managerState.desired.enabled}:['launch','wait-for-exit-and-launch'].includes(action)?{hostId:managerState.observed?.hostId||'codex-desktop'}:{};const result=await managerRequest(action,payload);document.querySelector('[data-notice]').textContent=result.result?.fileName?'診斷已保存：'+result.result.fileName:action==='exit'?'正在退出管理器…':'操作已送出。'}catch(e){document.querySelector('[data-notice]').textContent=e.message}finally{button.disabled=false}});
 await poll();setInterval(poll,1500);
}
boot().catch(error=>{renderCompanionState({phase:'offline',observed:{applied:false},error:{message:error.message}})});
