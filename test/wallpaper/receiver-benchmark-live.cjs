// Compare the saved pre-change receiver with current code on our own blank page.
// No original Codex connection and no user conversation content.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const {SceneEngine}=require('../../src/scene-engine.cjs'),{createLibrary}=require('../../src/wallpaper/library.cjs'),{WallpaperHost}=require('../../src/wallpaper/host.cjs'),{defaults}=require('../../src/wallpaper/schema.cjs'),{delay}=require('../../src/control.cjs');
(async()=>{
 const loadHost=async file=>{const m={exports:{}};new Function('require','module','exports',await fs.readFile(path.resolve(file),'utf8'))(createRequire(path.resolve('src/wallpaper/host.cjs')),m,m.exports);return m.exports.WallpaperHost};
 const BeforeHost=await loadHost(process.argv[2]||'.state/host-before-full-window.cjs'),AfterHost=process.argv[3]?await loadHost(process.argv[3]):WallpaperHost;
 const library=createLibrary({roots:[],dataRoot:path.resolve('.state/receiver-benchmark')});await library.scan();const engine=new SceneEngine({...defaults().playback,width:1920,height:1020,entry:library.get('builtin:miku')});const samples=[];
 try{
  await engine.start();await engine.pause();const client=engine.client;
  const frames=await client.evaluate(`(()=>{const c=document.createElement('canvas');c.width=1920;c.height=1020;const x=c.getContext('2d');x.drawImage(codexScene.canvas,0,0,1920,1020);const a=c.toDataURL('image/jpeg',.92);x.fillStyle='#196d8a';x.fillRect(0,0,4,4);return [a,c.toDataURL('image/jpeg',.92)]})()`);assert.equal(frames.length,2);assert.notEqual(frames[0],frames[1]);
  const id=(await client.send('Page.getFrameTree')).frameTree.frame.id;
  await client.send('Page.setDocumentContent',{frameId:id,html:'<!doctype html><html><body style="margin:0"><div id="root"><div data-app-shell-frame="true" style="position:relative;width:1920px;height:1020px"><aside class="app-shell-left-panel"><button aria-haspopup="menu" aria-label="目前模式：Codex">fixture</button></aside><div data-app-shell-active-page="true"><main data-app-shell-main-surface="default"><div data-composer-body><textarea></textarea></div></main></div></div></div></body></html>'});
  const uniqueFrame=(uri,n)=>{const bytes=Buffer.from(uri.slice(uri.indexOf(',')+1),'base64'),comment=Buffer.from(String(n).padStart(12,'0'));return 'data:image/jpeg;base64,'+Buffer.concat([bytes.subarray(0,2),Buffer.from([255,254,0,comment.length+2]),comment,bytes.subarray(2)]).toString('base64')};
  let sequence=0;
  await client.send('Performance.enable');const metrics=async()=>Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
  for(const mode of ['before','after','after','before']){
   const Host=mode==='before'?BeforeHost:AfterHost,host=new Host(client,'26.1027.6604.0');await host.apply(defaults());await host.paint(frames[0]);await host.confirmImage(frames[0]);await delay(250);
   const payloads=Array.from({length:150},(_,i)=>uniqueFrame(frames[i%2],sequence++));
   const before=await metrics(),cpu=process.cpuUsage(),start=performance.now();let paints=0;
   for(let i=0;i<150;i++){await host.paint(payloads[i]);paints++;await delay(Math.max(0,(i+1)*1000/30-(performance.now()-start)))}
   await host.confirmImage(payloads[149]);const elapsed=performance.now()-start,after=await metrics(),cpuUsed=process.cpuUsage(cpu),image=await host.imageMetrics();
   assert.deepEqual(image.outputSize,{width:1920,height:1020});samples.push({mode,paints,elapsedMs:elapsed,decodedLoads:image.loads,taskMsPerFrame:(after.TaskDuration-before.TaskDuration)*1000/paints,scriptMsPerFrame:(after.ScriptDuration-before.ScriptDuration)*1000/paints,nodeCpuMsPerFrame:(cpuUsed.user+cpuUsed.system)/1000/paints});await host.restoreAll();
  }
  const mean=(mode,key)=>{const s=samples.filter(x=>x.mode===mode);return s.reduce((n,x)=>n+x[key],0)/s.length},summary={};for(const key of ['taskMsPerFrame','scriptMsPerFrame','nodeCpuMsPerFrame'])summary[key]={before:mean('before',key),after:mean('after',key),ratio:mean('after',key)/mean('before',key)};
  const result={samples,summary,resolution:{width:1920,height:1020},fpsLimit:30,scope:'Own blank receiver, JPEG frames with unique comment metadata to avoid JavaScript source caching. Excludes scene rendering and GPU; not an original Codex FPS benchmark.'};await fs.writeFile('.state/receiver-benchmark-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await engine.close();await library.close()}
})().catch(error=>{console.error(error.stack);process.exitCode=1});
