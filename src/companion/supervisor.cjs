const {randomUUID}=require('node:crypto'),{errorInfo,isObservationCurrent}=require('./status.cjs');
function createSupervisor({paths,hosts,appearance,runner,mode='manager',clock={now:Date.now,setTimeout,clearTimeout,setInterval,clearInterval}}){
 const instanceId=randomUUID(),listeners=new Set();let inventory=[],selected='codex-desktop',generation=0,active=null,session=null,abort=null,closed=false,pending=null,dirty=false,watcher,interval,retryTimer,retries=0,launchIntent=null,fingerprint='',blockedFingerprint=null;
 let state={schemaVersion:1,mode,instanceId,revision:0,phase:'idle',desired:{enabled:false},observed:{applied:false,connected:false,hostId:selected,appVersion:null,generation,adapterId:null,adapterVersion:null,compatibility:null,heartbeatAt:null,confirmedAt:null,regions:{}},playback:{state:'off'},error:null,hosts:[],pendingLaunch:false};
 const snapshot=()=>structuredClone(state);
 let rendererFault=null,unsubscribeHealth,compatibilitySession=null,nextCompatibilityProbe=0,endpointWaitSince=null,endpointRetries=0;
 function publish(patch){state={...state,...patch,revision:state.revision+1};for(const listener of listeners)try{listener(snapshot())}catch{}}
 function revoke(){generation++;abort?.abort();publish({phase:'connecting',observed:{...state.observed,applied:false,connected:false,suspended:false,hostUnresponsive:false,generation,confirmedAt:null,heartbeatAt:null}})}
 function clearRetry(){clock.clearTimeout(retryTimer);retryTimer=null}
 function resetRetries(){blockedFingerprint=null;retries=0;endpointWaitSince=null;endpointRetries=0;clearRetry()}
 function accept(list){
  inventory=list;const host=list.find(h=>h.id===selected);
  const roots=host?.processes?.map(p=>[p.pid,p.startTime,p.managed]).sort((a,b)=>a[0]-b[0]);
  const next=JSON.stringify([selected,host?.appPath,host?.appVersion,roots]);
  if(next!==fingerprint){
   const changed=!!fingerprint;fingerprint=next;compatibilitySession=null;nextCompatibilityProbe=0;resetRetries();
   if(changed&&(active||session||abort))revoke();
  }
  publish({hosts:list.map(h=>({id:h.id,kind:h.kind,appVersion:h.appVersion,running:!!h.processes?.length})),observed:{...state.observed,hostId:selected,appVersion:host?.appVersion||null}});
 }
 async function drop(){const old=active,oldSession=session;unsubscribeHealth?.();unsubscribeHealth=null;rendererFault=null;active=null;session=null;if(old){const result=await old.close();if(result?.restored===false&&inventory.some(h=>h.processes?.some(p=>p.pid===oldSession?.pid&&p.startTime===oldSession?.startTime)))throw Object.assign(new Error('Restore unconfirmed'),{code:'RESTORE_UNCONFIRMED',stage:'restore'})}}
 function fail(error){let code=error.code||'HOST_LAUNCH_FAILED';
  if(code==='HOST_ENDPOINT_PENDING'||code==='HOST_SHELL_PENDING'&&!active){
   endpointWaitSince??=clock.now();
   const remaining=90000-(clock.now()-endpointWaitSince);
   if(remaining>0){
    publish({phase:'checking',observed:{...state.observed,applied:false,connected:false,confirmedAt:null},error:errorInfo(code,error.stage||'connect',error.checks)});
    clearRetry();if(!closed)retryTimer=clock.setTimeout(()=>{retryTimer=null;queue()},Math.min(remaining,[500,1000,2000,4000,8000][Math.min(endpointRetries++,4)]));return;
   }
   code='HOST_ENDPOINT_TIMEOUT';
  }
  if(code==='HOST_SHELL_PENDING'){publish({phase:'checking',observed:{...state.observed,applied:false,confirmedAt:null},error:errorInfo(code,'probe',error.checks)});clock.clearTimeout(retryTimer);if(!closed)retryTimer=clock.setTimeout(()=>{retryTimer=null;queue()},2000);return}publish({phase:code==='HOST_NEEDS_MANAGED_LAUNCH'?'needs-launch':['ADAPTER_LAYOUT_MISMATCH','HOST_TRANSPORT_UNAVAILABLE'].includes(code)?'incompatible':'error',observed:{...state.observed,applied:false,connected:false},error:errorInfo(code,error.stage||'connect',error.checks)});
  if(['ADAPTER_LAYOUT_MISMATCH','HOST_TRANSPORT_UNAVAILABLE','HOST_ENDPOINT_TIMEOUT'].includes(code)||error.retryBlocked||!error.retryManaged&&retries>=5){blockedFingerprint=fingerprint;launchIntent=null;clock.clearTimeout(retryTimer);retryTimer=null;publish({pendingLaunch:false})}
  else if(['HOST_LAUNCH_FAILED','HOST_IDENTITY_CHANGED','RENDERER_FAILED'].includes(code)&&!closed){clock.clearTimeout(retryTimer);retryTimer=clock.setTimeout(()=>{retryTimer=null;queue()},error.retryManaged?0:[500,1000,2000,4000,8000][retries++])}
 }
 async function reconcileInternal(){
  if(closed)return;const view=await appearance.view();state.desired={enabled:view.settings.enabled,wallpaperEnabled:view.settings.wallpaper?.enabled!==false,sceneLive:view.settings.playback?.sceneLive!==false};
  const checked=fingerprint;
  if(session&&session.generation!==generation)await drop();
  if(closed||checked!==fingerprint)return;
  if(rendererFault&&active?.hostResponsive?.()!==false)throw rendererFault;
  if(blockedFingerprint===fingerprint){
   if(state.error?.code==='ADAPTER_LAYOUT_MISMATCH'&&compatibilitySession&&runner.probe&&clock.now()>=nextCompatibilityProbe){
    nextCompatibilityProbe=clock.now()+10000;
    const probedFingerprint=fingerprint,probedSession=compatibilitySession,ready=await runner.probe(probedSession);
    if(closed||probedFingerprint!==fingerprint||probedSession!==compatibilitySession)return;
    if(ready===true){blockedFingerprint=null;compatibilitySession=null;retries=0;publish({phase:'checking',error:null})}
   }
   if(blockedFingerprint===fingerprint){if(!view.settings.enabled)publish({phase:'disabled'});return}
  }if(retryTimer)return;
  const host=inventory.find(h=>h.id===selected);if(!host){await drop();fail({code:'HOST_NOT_FOUND',stage:'discover'});return}
  if(!active){
   const roots=host.processes||[];
   if(host.kind!=='codex-desktop'){fail({code:'HOST_TRANSPORT_UNAVAILABLE'});return}
   if(roots.length&&!roots.every(p=>p.managed)){publish({pendingLaunch:launchIntent==='wait'});if(view.settings.enabled||launchIntent)fail({code:'HOST_NEEDS_MANAGED_LAUNCH'});else publish({phase:'disabled',error:null});return}
   if(!roots.length&&!launchIntent){publish({phase:view.settings.enabled?'idle':'disabled',observed:{...state.observed,applied:false,connected:false},error:null});return}
   endpointWaitSince??=clock.now();
   const epoch=++generation;abort=new AbortController();const signal=abort.signal;
   publish({phase:'connecting',observed:{...state.observed,generation},error:null});
   // Warm only our owned blank renderer after accepting a managed host (or an
   // explicit launch), while the full native endpoint checks run unchanged.
   Promise.resolve().then(()=>{if(!closed&&epoch===generation&&!signal.aborted)return runner.prewarm?.(view.settings)}).catch(()=>{});
   const candidateSession=await hosts.launch(selected,{generation:epoch,signal});if(closed||epoch!==generation)return;
   if(candidateSession?.generation!==epoch||roots.length&&!roots.some(p=>p.managed&&p.pid===candidateSession.pid&&p.startTime===candidateSession.startTime)){
    throw Object.assign(new Error('Host identity changed before attachment'),{code:'HOST_IDENTITY_CHANGED'});
   }
   session=candidateSession;publish({phase:'checking'});
   const candidate=await runner.attach(candidateSession,appearance,{instanceId,signal,sessionCurrent:()=>inventory.some(h=>h.processes?.some(p=>p.pid===candidateSession.pid&&p.startTime===candidateSession.startTime))});
   if(closed||epoch!==generation){await candidate.close();return}
   active=candidate;endpointWaitSince=null;endpointRetries=0;rendererFault=null;unsubscribeHealth=candidate.subscribeHealth?.(event=>{if(closed||event.expected||event.healthy!==false||active!==candidate||generation!==epoch||rendererFault)return;rendererFault=Object.assign(new Error('RENDERER_FAILED'),{code:'RENDERER_FAILED',stage:'render',retryManaged:event.retryManaged!==false,retryBlocked:event.retryBlocked===true});publish({phase:'checking',observed:{...state.observed,applied:false,rendererHealthy:false,confirmedAt:null}});queue()});launchIntent=null;clearRetry();publish({pendingLaunch:false});
  }
  const observed=await active.observe();if(closed||session?.generation!==generation)return;if(rendererFault&&!observed.hostUnresponsive)throw rendererFault;
  if(observed.suspended){const outputFailed=observed.playback?.state==='error',hostUnresponsive=observed.hostUnresponsive===true;publish({phase:outputFailed?'error':state.desired.enabled?'paused':'disabled',observed:{...state.observed,applied:false,connected:observed.connected,suspended:true,hostUnresponsive},playback:observed.playback,error:hostUnresponsive?errorInfo('HOST_UNRESPONSIVE','observe'):outputFailed?errorInfo('RENDERER_FAILED','render'):null});return}
  if(observed.connected&&launchIntent){launchIntent=null;publish({pendingLaunch:false})}
  const proof={...observed,instanceId,generation,sessionId:session.sessionId,pid:session.pid,startTime:session.startTime,heartbeatAt:clock.now()};
  const applied=state.desired.enabled&&isObservationCurrent(proof,{instanceId,generation,...session},clock.now());
  if(applied||!state.desired.enabled&&proof.connected&&proof.layoutPassed)retries=0;
  const adapter=active.adapter||{},partial=Object.values(adapter.regions||{}).some(r=>!r.supported),playback=observed.playback||{state:'off'};
  if(observed.requestedImage&&observed.rendererHealthy!==true)throw Object.assign(new Error('RENDERER_FAILED'),{code:'RENDERER_FAILED',stage:'render',...observed.failure});
  publish({phase:!state.desired.enabled?'disabled':!applied?'checking':playback.state==='paused'?'paused':partial?'partial':'active',observed:{applied,connected:proof.connected,suspended:false,hostUnresponsive:false,rendererHealthy:proof.rendererHealthy,hostId:selected,appVersion:session.appVersion,generation,adapterId:adapter.adapterId||null,adapterVersion:adapter.adapterVersion||null,compatibility:adapter.compatibility||null,heartbeatAt:proof.heartbeatAt,confirmedAt:applied?clock.now():null,regions:adapter.regions||{}},playback,error:view.dirty?errorInfo('SETTINGS_INVALID','settings'):view.error?errorInfo('RENDERER_FAILED','render'):partial?errorInfo('ADAPTER_PARTIAL','probe'):null});
 }
 function queue(){
  dirty=true;if(pending)return pending;
  pending=(async()=>{
   try{do{
    dirty=false;const checked=fingerprint;
    try{await reconcileInternal()}catch(error){
     if(closed||checked!==fingerprint||error.name==='AbortError'||abort?.signal.aborted)continue;
     const failedGeneration=generation,reason=rendererFault||error;
     if(reason.code==='ADAPTER_LAYOUT_MISMATCH'){compatibilitySession=session;nextCompatibilityProbe=clock.now()+10000}
     if(reason.code!=='HOST_SHELL_PENDING'||!active)await drop().catch(()=>{});
     if(!closed&&checked===fingerprint&&failedGeneration===generation)fail(reason);
    }
   }while(dirty&&!closed)}finally{pending=null}
  })();return pending;
 }
 return {
  instanceId,snapshot,subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener)},
  captionHost(){const host=inventory.find(h=>h.id===selected);if(host?.kind!=='codex-desktop'||host.processes?.length!==1)return null;const process=host.processes[0];return {pid:process.pid,startTime:process.startTime,appPath:host.appPath,appVersion:host.appVersion}},
  updateEntry(entry){if(!['starting','ready','hidden','unsupported','error','off'].includes(entry.state))return;const next={state:entry.state,error:entry.error==='CAPTION_BOUNDS_UNAVAILABLE'||entry.error==='RUNTIME_MISSING'?entry.error:null};if(JSON.stringify(state.entry)!==JSON.stringify(next))publish({entry:next})},
  async start(){
   publish({phase:'connecting'});
   let list;try{list=await hosts.scan()}catch{if(!closed)fail({code:'HOST_NOT_FOUND',stage:'discover'})}
   if(closed)return snapshot();
   if(list)accept(list);
   watcher=hosts.watch(event=>{
    if(closed)return;
    if(event.type==='hosts'){accept(event.hosts);queue()}
    else if(!active&&!session&&!inventory.some(h=>h.processes?.length))fail({code:event.code||'HOST_NOT_FOUND',stage:'discover'});
   });
   interval=clock.setInterval(()=>queue(),2000);
   if(list)await queue();return snapshot();
  },
  reportError:fail,
  reconcile:queue,
  attachExisting(){
   if(closed||active||!inventory.some(h=>h.id===selected&&h.kind==='codex-desktop'&&h.processes?.length===1&&h.processes[0].managed))return;
   if(blockedFingerprint===fingerprint&&['HOST_ENDPOINT_TIMEOUT','HOST_LAUNCH_FAILED','HOST_IDENTITY_CHANGED'].includes(state.error?.code)){
    resetRetries();publish({phase:'checking',error:null});
   }
   void queue();
  },
  async reconnect(){if(active?.hostResponsive?.()===false)return snapshot();runner.resetFailures?.();resetRetries();accept(await hosts.scan());if(active||session)revoke();await queue();return snapshot()},
  async launch(hostId=selected){if(hostId===selected&&active&&session&&state.observed.connected&&hosts.activate){if(active.hostResponsive?.()!==false)await hosts.activate(session);return snapshot()}endpointWaitSince=null;endpointRetries=0;const wasActive=!!active;if(!inventory.some(h=>h.id===hostId))throw Object.assign(new Error('Host not found'),{code:'HOST_NOT_FOUND'});blockedFingerprint=null;selected=hostId;launchIntent='launch';accept(await hosts.scan());await queue();if(wasActive&&session&&active?.hostResponsive?.()!==false)await hosts.activate?.(session);return snapshot()},
  async waitForExitAndLaunch(hostId=selected){if(!inventory.some(h=>h.id===hostId))throw Object.assign(new Error('Host not found'),{code:'HOST_NOT_FOUND'});blockedFingerprint=null;selected=hostId;launchIntent='wait';accept(inventory);publish({pendingLaunch:true});await queue();return snapshot()},
  async enableWallpaper(){runner.resetFailures?.();blockedFingerprint=null;compatibilitySession=null;retries=0;clock.clearTimeout(retryTimer);retryTimer=null;await appearance.controller.patch({enabled:true,wallpaper:{enabled:true}});await queue();return snapshot()},
  async setEnabled(enabled){if(typeof enabled!=='boolean')throw new Error('Expected enabled boolean');if(enabled){runner.resetFailures?.();blockedFingerprint=null;retries=0}await appearance.controller.patch({enabled});await queue();return snapshot()},
  async close(){if(closed)return;closed=true;abort?.abort();clock.clearInterval(interval);clock.clearTimeout(retryTimer);watcher?.close();hosts.close();await pending;await drop();publish({phase:'offline',observed:{...state.observed,applied:false,connected:false}});listeners.clear()}
 };
}
module.exports={createSupervisor};
