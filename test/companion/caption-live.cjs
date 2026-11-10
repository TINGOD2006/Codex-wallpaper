const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{spawn,execFile}=require('node:child_process'),{promisify}=require('node:util'),{randomUUID}=require('node:crypto');
const {resolvePaths}=require('../../src/companion/paths.cjs'),{startControlServer}=require('../../src/companion/control-server.cjs'),{createStore}=require('../../src/wallpaper/store.cjs'),{createLibrary}=require('../../src/wallpaper/library.cjs'),{createPresets}=require('../../src/wallpaper/presets.cjs'),{createAppearanceService}=require('../../src/companion/appearance-service.cjs'),{delay}=require('../../src/control.cjs'),{atomicJson}=require('../../src/config.cjs');
(async()=>{
 const base=path.resolve('.state/caption-'+Date.now()),paths=resolvePaths({localAppData:base});await fs.mkdir(paths.runtime,{recursive:true});
 const store=createStore(paths.data),library=createLibrary({dataRoot:paths.data,runtimeRoot:paths.runtime});await library.scan();
 const appearance=await createAppearanceService({store,library,presets:createPresets({store,library,dataRoot:paths.data}),chooseFile:async()=>({cancelled:true})});
 const state={instanceId:'caption-fixture',phase:'incompatible',desired:{enabled:true},observed:{applied:false,appVersion:'fixture'},error:{code:'HOST_TRANSPORT_UNAVAILABLE',message:'Fixture: background unavailable, controls remain usable'}};
 const server=await startControlServer({paths,supervisor:{instanceId:state.instanceId,snapshot:()=>state,captionHost:()=>null},appearance});
 const descriptorPath=path.join(paths.runtime,'manager.json'),descriptor=JSON.parse(await fs.readFile(descriptorPath,'utf8'));await atomicJson(descriptorPath,{...descriptor,entryFile:__filename});
 const identity=path.join(base,'host.json'),hostCommands=path.join(base,'host-commands.json'),commands=path.join(base,'commands.json'),statusFile=path.join(paths.runtime,'caption-status.json');let host,caption,player,errors='';
 const launch=(file,args)=>{const p=spawn(process.env.MIKU_PWSH||'pwsh',['-NoProfile','-STA','-File',path.resolve(file),...args],{windowsHide:true,stdio:['ignore','pipe','pipe']});p.stderr.on('data',data=>errors+=data);return p};
 async function status(){return JSON.parse(await fs.readFile(statusFile,'utf8'))}
 async function until(check,label,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){try{if(await check())return}catch{}if(caption?.exitCode!==null&&caption?.exitCode!==undefined)throw new Error('Caption exited: '+errors);await delay(150)}throw new Error('Timeout '+label+'\n'+errors)}
 let sequence=0;const send=(file,action)=>atomicJson(file,{id:String(++sequence),action});
 async function inspect(){await send(commands,'inspect');await until(async()=>!!(await status()).testResult,'WebView inspection');const raw=(await status()).testResult;return JSON.parse(JSON.parse(raw))}
 try{
  host=launch('test/companion/caption-fixture.ps1',['-IdentityPath',identity,'-CommandsPath',hostCommands]);await until(()=>fs.access(identity).then(()=>true),'fixture host');
  caption=launch('scripts/companion-caption.ps1',['-DescriptorPath',path.join(paths.runtime,'manager.json'),'-FixtureHostPath',identity,'-TestCommandsPath',commands]);
  await until(async()=>(await status()).state==='ready','caption attached');const initial=await status();assert.ok(initial.button.x+initial.button.width<initial.nativeButtonsLeft);assert.equal(initial.presentation.visible,true);assert.equal(initial.presentation.topMost,true);assert.equal(initial.presentation.hitConfirmed,true);
  await delay(3400);assert.ok(Date.parse((await status()).observedAt)>Date.parse(initial.observedAt),'Unchanged ready status must still receive fresh timestamps');
  const repairs=(await status()).presentation.repairs;await send(commands,'drop-layer');await until(async()=>{const s=await status();return s.state==='ready'&&s.presentation.repairs>repairs&&s.presentation.topMost&&s.presentation.hitConfirmed},'automatic recovery after native topmost loss');
  await send(commands,'open');await until(async()=>{const s=await status();return s.initialized&&s.sidebarVisible},'sidebar initialized',35000);await delay(1600);
  const first=await inspect();assert.deepEqual(first.tabs,['桌布庫','畫面','材質','播放','預設']);assert.equal(first.hidden,false);assert.equal(first.overflow,false);assert.ok(Math.abs(first.width-420)<=2,'Sidebar must retain original CSS width at native DPI');assert.match(first.hostStatus,/Fixture/);
  const launchId=randomUUID(),bootRoot=path.join(paths.runtime,'boot-animation'),bootState=path.join(bootRoot,launchId+'.json'),requestFile=path.join(bootRoot,'last-request.json');await fs.mkdir(bootRoot,{recursive:true});
  await atomicJson(bootState,{LaunchId:launchId,HostPid:0,HostStartTime:'',HostPath:'',Ready:false,Failed:false});
  await atomicJson(requestFile,{launchId,ticks:(BigInt(Date.now())*10000n+621355968000000000n).toString()});
  player=spawn(path.resolve('assets/boot-animation/DragonBoot.exe'),['--state-file',bootState,'--launch-id',launchId],{windowsHide:true,stdio:'ignore'});player.on('error',e=>{errors+=e.message});
  const stamp=JSON.parse((await promisify(execFile)(process.env.MIKU_PWSH||'pwsh',['-NoProfile','-File',path.resolve('scripts/companion-security.ps1'),'-Operation','Stamp','-ManagerPid',String(player.pid)],{windowsHide:true})).stdout);
  await atomicJson(requestFile,{launchId,playerPid:player.pid,playerStartTime:stamp.startTime});
  await until(async()=>{const s=await status();return s.animationActive&&s.state==='hidden'&&!s.buttonVisible&&!s.sidebarVisible},'animation hides native button and sidebar');
  await send(commands,'open');await delay(1200);const covered=await status();assert.equal(covered.animationActive,true);assert.equal(covered.buttonVisible,false);assert.equal(covered.sidebarVisible,false);
  // Use this owned session's failure handoff rather than a main-window close:
  // the player is a tool window and does not expose Process.MainWindowHandle.
  await atomicJson(bootState,{LaunchId:launchId,HostPid:0,HostStartTime:'',HostPath:'',Ready:false,Failed:true});
  await until(()=>player.exitCode!==null,'owned player exit');
  await until(async()=>{const s=await status();return !s.animationActive&&s.state==='ready'&&s.buttonVisible&&s.sidebarVisible},'animation exit restores button and prior sidebar');player=null;
  await send(hostCommands,'move');await until(async()=>(await status()).button.x!==initial.button.x,'move tracking');const moved=await status();assert.ok(moved.button.x+moved.button.width<moved.nativeButtonsLeft);
  await send(hostCommands,'maximize');await delay(700);const maximized=await status();assert.equal(maximized.state,'ready');assert.ok(maximized.button.x+maximized.button.width<maximized.nativeButtonsLeft);
  await send(hostCommands,'minimize');await until(async()=>{const s=await status();return s.state==='hidden'&&!s.sidebarVisible},'minimize hides both');
  await send(hostCommands,'restore');await until(async()=>{const s=await status();return s.state==='ready'&&s.sidebarVisible},'restore tracking');
  for(let cycle=0;cycle<5;cycle++){
   await send(hostCommands,'minimize');await until(async()=>{const s=await status();return s.state==='hidden'&&!s.sidebarVisible},'repeat minimize '+cycle);
   await send(hostCommands,'restore');await until(async()=>{const s=await status();return s.state==='ready'&&s.sidebarVisible},'repeat restore '+cycle);
  }
  assert.equal((await status()).error,null);assert.equal((await status()).layoutSource,'cache');
  await send(commands,'close');await until(async()=>!(await status()).sidebarVisible,'close sidebar');await send(commands,'open');await until(async()=>(await status()).sidebarVisible,'reopen sidebar');
  await fs.writeFile(path.join(paths.runtime,'caption-stop'),state.instanceId);await until(()=>caption.exitCode!==null,'graceful caption stop');assert.equal(host.exitCode,null,'Caption stop must not stop its host');
  const result={pass:true,buttonLeftOfMinimize:true,oldFiveTabs:true,noBrowserChrome:true,animationHidesOverlays:true,playerExitRestoresOverlays:true,moveMaximizeMinimizeRestore:true,reopen:true,backgroundErrorVisible:true,hostUnaffectedByExit:true};await fs.writeFile(path.join(base,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{if(player?.exitCode===null)player.kill();if(caption?.exitCode===null){await fs.writeFile(path.join(paths.runtime,'caption-stop'),state.instanceId);await delay(800);if(caption.exitCode===null)caption.kill()}if(host?.exitCode===null){await send(hostCommands,'exit');await delay(500);if(host.exitCode===null)host.kill()}await server.close();await appearance.close();await library.close();if(errors)await fs.writeFile(path.join(base,'stderr.log'),errors)}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
