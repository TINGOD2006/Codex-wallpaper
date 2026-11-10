const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const {connectManaged}=require('../../src/cli.cjs'),{delay,sendCommand}=require('../../src/control.cjs'),{createStore}=require('../../src/wallpaper/store.cjs'),{createLibrary}=require('../../src/wallpaper/library.cjs');
(async()=>{
 const {client,identity}=await connectManaged('.state/session.json');assert.equal(identity.mode,'Isolated');const dataRoot=path.resolve('.state/wallpaper'),store=createStore(dataRoot),original=await store.load(),library=createLibrary({roots:[],dataRoot});let imported;
 const run=promisify(execFile),windowAction=async op=>JSON.parse((await run(process.env.MIKU_PWSH||'pwsh',['-NoProfile','-File','test/wallpaper/window-playback.Tests.ps1','-Operation',op],{windowsHide:true})).stdout),status=()=>fs.readFile('.state/status.json','utf8').then(JSON.parse);
 async function until(check,label){const end=Date.now()+20000;while(Date.now()<end){if(await check())return;await delay(150)}throw new Error('Timeout: '+label)}
 const signature=()=>client.evaluate(`(()=>{const s=document.getElementById('codex-wallpaper-image')?.src||'';let h=0;for(let i=0;i<s.length;i++)h=(Math.imul(h,31)+s.charCodeAt(i))|0;return h})()`);
 try{
  await windowAction('Restore');await delay(1100);
  await library.scan();imported=await library.importFile(path.resolve('test/wallpaper/fixtures/motion.webm'));await client.evaluate(`(()=>{if(document.getElementById('codex-wallpaper-panel').hidden)document.getElementById('codex-wallpaper-button').click();document.getElementById('cw-tab-library').click();[...document.querySelectorAll('#cw-section-library button')].find(b=>b.textContent==='重新掃描').click()})()`);await delay(600);
  await client.evaluate(`(()=>{const q=document.querySelector('[aria-label="搜尋桌布"]');q.value='motion.webm';q.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-id='+CSS.escape(${JSON.stringify(imported.id)})+'] .cw-pick').click()})()`);await until(async()=>(await store.load()).wallpaper.selectedId===imported.id,'select video');
  await client.evaluate(`(()=>{const i=document.querySelector('[data-setting="enabled"]');if(!i.checked)i.click()})()`);await until(async()=>(await status()).playback.state==='playing','video playing');const a=await signature();await until(async()=>(await signature())!==a,'video advances without relying on a loop-period sample');
  await windowAction('Minimize');await until(async()=>(await status()).playback.state==='paused','minimized pause');const paused=await signature();await delay(600);assert.equal(await signature(),paused);await windowAction('Restore');await until(async()=>(await status()).playback.state==='playing','restore resume');
  const resources=await windowAction('Measure'),result={pass:true,appVersion:identity.appVersion,mode:identity.mode,videoAdvances:true,nativeMinimizePause:true,nativeRestoreResume:true,resources};await fs.writeFile('.state/validation/wallpaper-media-0.4.0.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{
  try{await windowAction('Restore').catch(()=>{});await store.save(original);await sendCommand(path.resolve('.state'),original.enabled?'apply':'disable')}
  finally{
   try{if(imported){const expected=path.resolve(dataRoot,'imports'),target=path.resolve(imported.directory);if(!target.startsWith(expected+path.sep)||!/^local:[\da-f-]{36}$/.test(imported.id))throw new Error('Unsafe fixture cleanup');await fs.rm(target,{recursive:true,force:true})}}
   finally{await library.close();client.close()}
  }
 }
})().catch(e=>{console.error(e.stack);process.exitCode=1});
