const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const {SceneEngine}=require('../../src/scene-engine.cjs'),{createLibrary}=require('../../src/wallpaper/library.cjs'),{delay}=require('../../src/control.cjs');
(async()=>{
 const dataRoot=await fs.mkdtemp(path.join(os.tmpdir(),'cw-plugin-ui-')),library=createLibrary({dataRoot});await library.scan();
 const engine=new SceneEngine({entry:library.get('builtin:miku'),width:1280,height:800,renderFps:20,runtimeRoot:dataRoot});
 const fixture=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><body style="margin:0"><iframe style="border:0;width:100%;height:790px"></iframe></body>')});await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
 try{
  await engine.start();await engine.pause();const client=engine.client,frame=(await client.send('Page.getFrameTree')).frameTree.frame.id,html=await fs.readFile('dist/plugin/codex-wallpaper-control/dist/control.html','utf8');
  await client.send('Page.navigate',{url:'http://127.0.0.1:'+fixture.address().port});for(let n=0;n<30;n++){if(await client.evaluate(`!!document.querySelector('iframe')`))break;await delay(50)}
  await client.evaluate(`(()=>{window.fixtureCalls=[];window.fixtureState={phase:'needs-launch',desired:{enabled:true},observed:{applied:false,appVersion:'99.1.2.3'},error:{code:'HOST_NEEDS_MANAGED_LAUNCH',message:'請正常退出後由管理器啟動。'}};window.addEventListener('message',event=>{const m=event.data;if(!m||m.id===undefined)return;let result;if(m.method==='ui/initialize')result={protocolVersion:'2026-01-26',hostInfo:{name:'fixture',version:'1'},hostCapabilities:{},hostContext:{theme:'dark',displayMode:'inline',styles:{variables:{'--color-background-primary':'#191b20'}}}};else if(m.method==='tools/call'){window.fixtureCalls.push(m.params.name);result={content:[],structuredContent:window.fixtureState}}else result={};event.source.postMessage({jsonrpc:'2.0',id:m.id,result},'*')});document.querySelector('iframe').srcdoc=${JSON.stringify(html)}})()`);
  for(let n=0;n<60;n++){if(await client.evaluate(`document.querySelector('iframe').contentDocument?.getElementById('phase')?.textContent==='需要由管理器啟動'`))break;await delay(100)}
  assert.equal(await client.evaluate(`document.querySelector('iframe').contentDocument.getElementById('phase').textContent`),'需要由管理器啟動');
  for(const width of [375,768,1440]){await client.send('Emulation.setDeviceMetricsOverride',{width,height:812,deviceScaleFactor:1,mobile:false});await delay(100);assert.ok(await client.evaluate(`(()=>{const d=document.querySelector('iframe').contentDocument;return d.documentElement.scrollWidth<=d.documentElement.clientWidth+1})()`),'Plugin width overflow: '+width)}
  await client.evaluate(`document.querySelector('iframe').contentDocument.querySelector('[data-tool="wallpaper_open_manager"]').click()`);await delay(100);assert.ok((await client.evaluate('window.fixtureCalls')).includes('wallpaper_open_manager'));
  console.log(JSON.stringify({pass:true,appHandshake:true,viewportWidths:[375,768,1440],managerButton:true,visibleNeedsLaunch:true}));
 }finally{await engine.close();await library.close();fixture.closeAllConnections();await new Promise(resolve=>fixture.close(resolve))}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
