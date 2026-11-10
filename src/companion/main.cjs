const fs=require('node:fs/promises'),path=require('node:path'),{spawn,execFile}=require('node:child_process'),{promisify}=require('node:util');
const {resolvePaths}=require('./paths.cjs'),{migrateData}=require('./migration.cjs'),{createWindowsHosts}=require('./windows-hosts.cjs'),{createAppearanceService}=require('./appearance-service.cjs'),{createSupervisor}=require('./supervisor.cjs'),{createRuntimeRunner}=require('./runtime-runner.cjs'),{startControlServer}=require('./control-server.cjs');
const {createStore}=require('../wallpaper/store.cjs'),{createLibrary,discoverSteamRoots}=require('../wallpaper/library.cjs'),{createPresets}=require('../wallpaper/presets.cjs'),{chooseFile}=require('../wallpaper/file-dialog.cjs');
const run=promisify(execFile);
const {ensureSettingsV2}=require('../wallpaper/settings-migration.cjs');
const {createRendererService}=require('../renderer/service.cjs');
const {createCaptionWorker}=require('./caption-worker.cjs');
const {createAttachedLifetime}=require('./attached-lifetime.cjs');
async function runCompanion({paths=resolvePaths(),legacyRoot,headless=false,integrated=false}={}){
 const started=performance.now(),startup={schemaVersion:1,at:new Date().toISOString(),stages:{}};let timingJob=Promise.resolve();
 const mark=stage=>{if(Object.hasOwn(startup.stages,stage))return;startup.stages[stage]=Math.round(performance.now()-started);const value=structuredClone(startup);timingJob=timingJob.then(()=>require('../config.cjs').atomicJson(path.join(paths.logs,'startup-timing.json'),value)).catch(()=>{})};
 for(const folder of [paths.root,paths.runtime,paths.logs])await fs.mkdir(folder,{recursive:true});
 await migrateData({legacyRoot,paths});await ensureSettingsV2(paths.data);const store=createStore(paths.data),saved=await store.load();
 mark('settingsReadyMs');
 const rendererService=createRendererService({paths});await rendererService.configure(saved.performance);
 const library=createLibrary({roots:[...await discoverSteamRoots(),...saved.library.roots],dataRoot:paths.data,runtimeRoot:paths.runtime,renderPoster:(entry,options)=>rendererService.poster(entry,options)});await library.scan();
 mark('libraryReadyMs');
 const presets=createPresets({dataRoot:paths.data,store,library}),appearance=await createAppearanceService({store,library,presets,rendererService,chooseFile:options=>chooseFile(options)});
 const hosts=createWindowsHosts({paths}),runner=createRuntimeRunner({paths,store,library,presets,rendererService}),supervisor=createSupervisor({paths,hosts,appearance,runner,mode:integrated?'integrated':'manager'});let control,tray,captionWorker,captionLog,stopping=false,stopJob,lifetime,unsubscribeLifetime;
 let unsubscribeStartup=supervisor.subscribe(state=>{if(state.observed.connected)mark('nativeConnectedMs');if(state.observed.applied)mark('firstAppliedMs');if(state.entry?.state==='ready')mark('entryReadyMs');if(startup.stages.firstAppliedMs!==undefined&&startup.stages.entryReadyMs!==undefined){unsubscribeStartup?.();unsubscribeStartup=null}});
 const edgeCandidates=[path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe'),path.join(process.env.ProgramFiles||'C:/Program Files','Microsoft/Edge/Application/msedge.exe')];let edgePath;
 for(const candidate of edgeCandidates)try{await fs.access(candidate);edgePath=candidate;break}catch{}
 const windowAction=(action,url)=>run(process.env.MIKU_PWSH||'pwsh',['-NoProfile','-File',path.resolve(__dirname,'../../scripts/companion-window.ps1'),'-Action',action,'-RuntimeRoot',paths.runtime,'-EdgePath',edgePath,...(url?['-Url',url]:[])],{windowsHide:true,timeout:15000});
 async function stopCaption(){const child=captionWorker?.stop();if(child&&child.exitCode===null&&child.pid){await fs.writeFile(path.join(paths.runtime,'caption-stop'),supervisor.instanceId);await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill();resolve()},2000);child.once('exit',()=>{clearTimeout(timer);resolve()})})}await captionLog?.close();captionLog=null}

 function stop(){if(stopJob)return stopJob;stopping=true;unsubscribeLifetime?.();unsubscribeStartup?.();lifetime?.close();stopJob=(async()=>{const errors=[];for(const close of [stopCaption,()=>supervisor.close(),()=>appearance.close(),()=>library.close(),()=>rendererService.close(),async()=>{if(!headless&&!integrated&&edgePath)await windowAction('Close')},async()=>tray?.kill(),()=>timingJob])try{await close()}catch(error){errors.push(error)}setTimeout(async()=>{await control?.close();process.exitCode=errors.length?1:0},100);if(errors.length)throw new AggregateError(errors,'Companion cleanup failed')})();return stopJob}
 try{
  // Native discovery/attachment does not depend on the HTTP descriptor. Start
  // it while the control server prepares its private ACL and process stamp.
  supervisor.start().catch(()=>supervisor.reportError({code:'RUNTIME_MISSING',stage:'discover'}));
  control=await startControlServer({paths,supervisor,appearance,recoverEntry:()=>captionWorker?.retry(),showWindow:async url=>{if(integrated)throw Object.assign(new Error('Use the Wallpaper sidebar'),{code:'SIDEBAR_ONLY'});if(!headless){if(!edgePath)throw Object.assign(new Error('Edge missing'),{code:'RUNTIME_MISSING'});await windowAction('Show',url)}},onExit:stop});
  mark('controlReadyMs');
  if(integrated){lifetime=createAttachedLifetime({stop});unsubscribeLifetime=supervisor.subscribe(state=>lifetime.observe(state));lifetime.observe(supervisor.snapshot())}
  if(!headless&&!integrated){
   tray=spawn(process.env.MIKU_PWSH||'pwsh',['-NoProfile','-STA','-File',path.resolve(__dirname,'../../scripts/companion-tray.ps1'),'-DescriptorPath',path.join(paths.runtime,'manager.json')],{windowsHide:true,stdio:'ignore'});tray.on('error',()=>supervisor.reportError({code:'RUNTIME_MISSING',stage:'bootstrap'}));
   tray.once('exit',()=>{if(!stopping){supervisor.reportError({code:'RUNTIME_MISSING',stage:'bootstrap'});windowAction('Show',control.issueBootstrap()).catch(()=>{})}});
  }
  if(!headless){
   captionLog=await fs.open(path.join(paths.logs,'caption.stderr.log'),'a');
   captionWorker=createCaptionWorker({executable:process.env.MIKU_PWSH||'pwsh',args:['-NoProfile','-STA','-File',path.resolve(__dirname,'../../scripts/companion-caption.ps1'),'-DescriptorPath',path.join(paths.runtime,'manager.json')],stderr:captionLog.fd,report:event=>process.stderr.write(JSON.stringify(event)+'\n'),update:entry=>supervisor.updateEntry(entry),isExpectedStop:()=>fs.readFile(path.join(paths.runtime,'caption-stop'),'utf8').then(value=>value===supervisor.instanceId,()=>false)});
   captionWorker.start();
  }
  const shutdown=()=>stop().catch(()=>{process.exitCode=1});process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
  return {paths,supervisor,control,stop};
 }catch(e){unsubscribeStartup?.();await stopCaption().catch(()=>{});tray?.kill();await control?.close().catch(()=>{});await supervisor.close().catch(()=>{});await appearance.close().catch(()=>{});await library.close().catch(()=>{});await rendererService.close().catch(()=>{});await timingJob;throw e}
}
if(require.main===module){const args=process.argv.slice(2);if(args.some(arg=>!['--headless','--integrated','--legacy-root'].includes(arg)&&args[args.indexOf(arg)-1]!=='--legacy-root'))throw new Error('Unknown argument');runCompanion({headless:args.includes('--headless'),integrated:args.includes('--integrated'),legacyRoot:args.includes('--legacy-root')?args[args.indexOf('--legacy-root')+1]:undefined}).catch(e=>{process.stderr.write((e.code||'RUNTIME_MISSING')+'\n'+(e.stack||e.message||'Initialization failed')+'\n');process.exitCode=1})}
module.exports={runCompanion};
