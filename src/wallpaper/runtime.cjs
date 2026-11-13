const path=require('node:path');
const {createStore}=require('./store.cjs'),{migrateLegacy}=require('./migration.cjs'),{createLibrary,discoverSteamRoots}=require('./library.cjs');
const {WallpaperHost}=require('./host.cjs'),{WallpaperController}=require('./controller.cjs'),{WallpaperPanel}=require('./panel.cjs'),{createPresets}=require('./presets.cjs'),{createCommandHandler}=require('./commands.cjs'),{prepareRenderer}=require('./renderer.cjs'),{chooseFile}=require('./file-dialog.cjs');
const {detectLayout}=require('../adapters.cjs');
const {ensureSettingsV2}=require('./settings-migration.cjs');
async function createWallpaperRuntime({client,identity,projectRoot,dataRoot=path.join(projectRoot,'.state/wallpaper'),runtimeRoot,roots,windowVisible,hostResponsive=()=>true,services,mountPanel=true,Host=WallpaperHost,Panel=WallpaperPanel}){
 const assertResponsive=()=>{if(!hostResponsive())throw Object.assign(new Error('Host is not responding'),{code:'HOST_UNRESPONSIVE'})};
 assertResponsive();
 // Remove only verified legacy nodes, before measuring native surfaces. No legacy ThemeSession runs alongside this runtime.
 await client.evaluate(`(()=>{for(const id of ['miku-desktop-theme-v1','miku-live-scene-layer','miku-desktop-theme-toggle']){const n=document.getElementById(id);if(n&&n.dataset.owner!=='miku-desktop-theme')throw new Error('Legacy owner mismatch');n?.remove()}})()`);
 if(!mountPanel){assertResponsive();await client.evaluate(`(()=>{const p=window.__codexWallpaperPanel;if(p?.owner==='codex-wallpaper')p.dispose()})()`)}
 assertResponsive();
 const host=new Host(client,identity.appVersion),snapshot=await host.inspect(),layout=detectLayout(snapshot,identity.appVersion);if(!['codex','chatgpt'].includes(layout.kind))throw Object.assign(new Error(layout.reason),{code:'UNSUPPORTED_LAYOUT'});
 const store=services?.store||createStore(dataRoot),saved=await store.load(),library=services?.library||createLibrary({roots:roots??[...await discoverSteamRoots(),...saved.library.roots],dataRoot,runtimeRoot});if(!services?.library)await library.scan();
 try{
  if(!services)await migrateLegacy({projectRoot,dataRoot,resolveSelection:async source=>{
   let id=library.findSource(source),migratedRoots;
   if(!id){if(source.kind==='scene'){migratedRoots=await library.addRoot(source.directory);id=library.findSource(source)}else id=(await library.importFile(source.file)).id}
   return {id,roots:migratedRoots};
  }});
 }catch(e){if(!services?.library)await library.close();throw e}
 await ensureSettingsV2(dataRoot);
 const {usesStill,resolveSceneStill}=require('./scene-still.cjs');
 let startupImage=services?.startupImage;
 const takeStartupImage=()=>{const pending=startupImage;startupImage=null;return pending};
 const controller=new WallpaperController({store,library,host,prepareRenderer:async(entry,playback,options)=>{
  const still=usesStill(entry,playback)?await resolveSceneStill({entry,dataRoot,preferredFrame:options.stillFrame,preloaded:await takeStartupImage(),validate:uri=>{assertResponsive();return host.validateImage(uri)},signal:options.signal}):undefined;
  return services?.rendererService?services.rendererService.prepare(entry,playback,{...options,still,hostGeneration:identity.generation}):prepareRenderer(entry,playback,{...options,still,runtimeRoot});
 },windowVisible,hostResponsive}),presets=services?.presets||createPresets({dataRoot,store,library}),panel=mountPanel?new Panel(client,{sessionId:identity.sessionId,appVersion:identity.appVersion}):null;
 const view=()=>services?.appearance?services.appearance.view():Promise.resolve({...controller.snapshot(),cards:library.cards(controller.settings),presets:[]});
 let viewportJob;
 const measureViewport=()=>{if(!host.viewport||!hostResponsive())return Promise.resolve();if(viewportJob)return viewportJob;const job=host.viewport().then(value=>controller.setViewport(value));viewportJob=job;job.then(()=>{if(viewportJob===job)viewportJob=null},()=>{if(viewportJob===job)viewportJob=null});return job};
 const resized=event=>{if(event.method==='Page.frameResized'&&(!windowVisible||windowVisible()))measureViewport().catch(()=>{})};
 let confirmation=null,confirmedAt=0,lastPreviewWrite=0,previewWrite;
 const previewCache=path.join(dataRoot,'last-wallpaper-frame.json');
 const saveCurrentFrame=()=>{
  if(!services||controller.closed||!controller.settings.enabled||!controller.active||controller.active.status.still||controller.paintedRenderer!==controller.active||!controller.paintedFrame||controller.paintedFrame.length>=8*1024*1024||previewWrite||Date.now()-lastPreviewWrite<=10000)return previewWrite;
  lastPreviewWrite=Date.now();previewWrite=require('../config.cjs').atomicJson(previewCache,{selectedId:controller.settings.wallpaper.selectedId,uri:controller.paintedFrame}).catch(()=>{}).finally(()=>{previewWrite=null});return previewWrite;
 };
 try{
  await measureViewport();
  // A selected wallpaper's existing preview can cover scene preparation. It is
  // never reported as a live renderer, and never triggers a poster render here.
  let placeholder;
  if(services&&saved.enabled&&saved.wallpaper.enabled&&host.validateImage){
   const entry=library.get(saved.wallpaper.selectedId);
   const staged=services.startupPlaceholder;
   if(staged?.selectedId===saved.wallpaper.selectedId&&staged.documentToken===snapshot.documentToken)placeholder=staged;
   if(placeholder){
    // The earlier shell probe can show only a wallpaper. Apply the full appearance after the adapter passes.
    assertResponsive();await host.apply(saved);
   }else if(entry&&!usesStill(entry,{...saved.playback,powerSaving:saved.performance.powerSaving}))try{
    const image=await resolveSceneStill({entry,dataRoot,preloaded:await takeStartupImage(),validate:uri=>{assertResponsive();return host.validateImage(uri)}});
    if(image.source!=='empty'){
     assertResponsive();await host.apply(saved);assertResponsive();if(await host.paint(image.uri,{decoded:true})===false)throw Error('Startup image paint rejected');
     assertResponsive();if(!host.supportsDecodedPaint&&host.confirmImage&&!await host.confirmImage(image.uri))throw Error('Startup image decode failed');
     placeholder={...image,selectedId:entry.id};
    }
   }catch{/* Optional cached image never substitutes for live-renderer validation. */}
  }
  assertResponsive();client.on?.('notification',resized);await controller.start({placeholder});controller.initialRequest?.then(saveCurrentFrame);assertResponsive();if(services?.appearance)await services.appearance.attach(controller,identity.generation);
  if(panel){const handler=services?.appearance?{dispatch:command=>services.appearance.dispatch(command),close(){}}:createCommandHandler({sessionId:identity.sessionId,panelId:panel.panelId,controller,library,presets,chooseFile:options=>chooseFile({...options,ownerPid:identity.pid})});await panel.mount(handler);await panel.update(await view(),library.cards(controller.settings),await presets.list())}assertResponsive();if(host.confirmApplied){confirmation=await host.confirmApplied(controller.settings);confirmedAt=Date.now()}
 }catch(e){client.off?.('notification',resized);await panel?.unmount();await controller.close({preserveFrame:!!services?.startupPlaceholder&&controller.settings.enabled&&controller.settings.wallpaper.enabled});if(services?.appearance)await services.appearance.detach(identity.generation);if(!services?.library)await library.close();throw e}
 return {
  controller,library,presets,panel,host,
  status(){const snapshot=controller.snapshot(),requestedImage=!!(snapshot.settings.wallpaper.enabled&&snapshot.settings.wallpaper.selectedId),observedApplied=!!(snapshot.settings.enabled&&Date.now()-confirmedAt<=10000&&confirmation?.stylesConfirmed&&(!requestedImage||confirmation.imageConfirmed&&controller.active&&!controller.active.invalid&&['ready','paused'].includes(controller.active.status.state)));return {...snapshot,state:!snapshot.settings.enabled?'disabled':snapshot.playback.state==='error'?'error':observedApplied?'applied':'checking',observedApplied,layout:layout.kind,enabled:snapshot.settings.enabled,panelReady:!!panel?.ready,uiTogglePresent:!!panel?.ready,sceneAvailable:library.cards(snapshot.settings).some(c=>c.kind==='scene'&&c.capability==='supported'),sceneSelected:library.get(snapshot.settings.wallpaper.selectedId)?.kind==='scene',scene:snapshot.playback,reason:snapshot.error}},
  async action(action){if(!['apply','disable'].includes(action))throw new Error('Unknown wallpaper action');const settings=await store.load();settings.enabled=action==='apply';await controller.request(settings);await this.refresh();return this.status()},
  async refresh(){
   let sample;
   if(host.synchronize){
    sample=await controller.refreshHost();
    if(!sample)return confirmation;
    const current=detectLayout(sample.structure,identity.appVersion);layout.kind=current.kind;
    controller.setViewport(sample.viewport);
   }else{
    const current=detectLayout(await host.inspect(),identity.appVersion);if(!['codex','chatgpt'].includes(current.kind))throw Object.assign(new Error(current.reason),{code:'UNSUPPORTED_LAYOUT'});layout.kind=current.kind;
    await measureViewport();
    const imageMissing=!!(controller.active&&controller.settings.enabled&&controller.settings.wallpaper.enabled&&!await client.evaluate(`!!document.getElementById('codex-wallpaper-layer')`));await controller.refreshHost({imageMissing});
   }
   if(services?.rendererService){const metrics=sample?sample.metrics:host.imageMetrics?await host.imageMetrics():null;services.rendererService.observeReceiver({...metrics,playing:!!(!controller.active?.status.still&&controller.settings.enabled&&controller.settings.wallpaper.enabled&&!controller.settings.playback.paused&&!controller.outputSuspended())});await services.rendererService.refresh()}
   if(panel&&!await panel.update(await view(),library.cards(controller.settings),await presets.list()))throw new Error('Wallpaper panel needs remount');
   saveCurrentFrame();
   if(sample){confirmation=sample.proof;confirmedAt=Date.now()}
   else if(host.confirmApplied){confirmation=await host.confirmApplied(controller.settings);confirmedAt=Date.now()}
   return confirmation;
  },
  async close(options){await previewWrite;client.off?.('notification',resized);await viewportJob?.catch(()=>{});await panel?.unmount();try{return await controller.close(options)}finally{if(services?.appearance)await services.appearance.detach(identity.generation);if(!services?.library)await library.close()}}
 };
}
module.exports={createWallpaperRuntime};
