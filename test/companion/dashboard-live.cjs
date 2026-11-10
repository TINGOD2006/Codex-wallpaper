const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {SceneEngine}=require('../../src/scene-engine.cjs'),{createLibrary}=require('../../src/wallpaper/library.cjs'),{createStore}=require('../../src/wallpaper/store.cjs'),{createPresets}=require('../../src/wallpaper/presets.cjs');
const {createAppearanceService}=require('../../src/companion/appearance-service.cjs'),{startControlServer}=require('../../src/companion/control-server.cjs'),{resolvePaths}=require('../../src/companion/paths.cjs'),{delay}=require('../../src/control.cjs');
(async()=>{
 const paths=resolvePaths({localAppData:await fs.mkdtemp(path.join(os.tmpdir(),'cw-dashboard-'))}),store=createStore(paths.data),library=createLibrary({dataRoot:paths.data});await library.scan();
 const appearance=await createAppearanceService({store,library,presets:createPresets({store,library,dataRoot:paths.data}),chooseFile:async()=>({cancelled:true})});
 const state={instanceId:'fixture',phase:'needs-launch',desired:{enabled:true},observed:{applied:false,appVersion:'99.1.2.3'},hosts:[],error:{code:'HOST_NEEDS_MANAGED_LAUNCH',message:'請正常退出後由管理器開啟。'}};
 const server=await startControlServer({paths,supervisor:{instanceId:'fixture',snapshot:()=>state},appearance,protect:async()=>{}}),engine=new SceneEngine({entry:library.get('builtin:miku'),width:1280,height:720,renderFps:20,runtimeRoot:paths.runtime});
 try{
  await engine.start();await engine.pause();await engine.client.send('Page.navigate',{url:server.issueBootstrap()});
  for(let n=0;n<50;n++){if(await engine.client.evaluate(`document.querySelector('[data-error-code]')?.textContent==='HOST_NEEDS_MANAGED_LAUNCH'`))break;await delay(100)}
  assert.equal(await engine.client.evaluate(`document.querySelector('[data-error-code]')?.textContent`),'HOST_NEEDS_MANAGED_LAUNCH');
  assert.ok(await engine.client.evaluate(`document.querySelector('[data-host-status]').textContent.includes('需要')`));
  assert.equal(await engine.client.evaluate(`location.hash`),'');
  await engine.client.evaluate(`document.getElementById('cw-tab-materials').click();const i=document.querySelector('[data-setting="materials.sidebar.alpha"]');i.value='0.55';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('focusout',{bubbles:true}))`);await delay(700);
  assert.equal((await store.load()).materials.sidebar.alpha,.55);
  await server.close();await delay(2500);assert.ok(await engine.client.evaluate(`document.querySelector('[data-host-status]').textContent.includes('離線')`));
  console.log(JSON.stringify({pass:true,visibleNeedsLaunch:true,offlineDetected:true,settingsPersist:true,bootstrapRemoved:true}));
 }finally{await server.close();await engine.close();await appearance.close();await library.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
