const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {connectManaged}=require('../src/cli.cjs');
const {StyleHost,STYLE_ID}=require('../src/style-host.cjs');
const {detectLayout}=require('../src/adapters.cjs');
const {readJson,atomicJson}=require('../src/config.cjs');
const {sendCommand}=require('../src/control.cjs');
const root=path.resolve(__dirname,'..'),state=path.join(root,'.state');
async function main(){
  const kind=process.argv[2];assert.ok(['codex','chatgpt'].includes(kind),'Specify codex or chatgpt');
  const identity=await readJson(path.join(state,'session.json'));assert.equal(identity.mode,'Isolated');
  const {client}=await connectManaged(path.join(state,'session.json'));
  const host=new StyleHost(client);
  const output=path.join(state,'validation',`${identity.sessionId}-${kind}`);await fs.mkdir(output,{recursive:true});
  const geometry=`(() => [...document.querySelectorAll('[data-app-shell-active-page="true"] main[data-app-shell-main-surface="default"],.app-shell-left-panel,[data-app-shell-active-page="true"] [data-composer-body],[contenteditable="true"]')].filter(e=>e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})).map(e=>{const r=e.getBoundingClientRect();const h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {rect:[r.x,r.y,r.width,r.height],hit:h===e||e.contains(h)}}))()`;
  const report={appVersion:identity.appVersion,mode:'Isolated',layout:kind,viewports:[],interactionChecks:'not-tested',sentMessages:false};
  try {
    assert.equal(detectLayout(await host.inspect(),identity.appVersion).kind,kind,'Switch the isolated window to the requested mode first');
    for(const [width,height]of [[1280,720],[1536,816]]){
      await client.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await sendCommand(state,'disable');
      const baseline=await client.evaluate(geometry);
      assert.equal((await sendCommand(state,'apply')).state,'applied');
      assert.equal((await sendCommand(state,'apply')).state,'applied');
      assert.deepEqual(await client.evaluate(geometry),baseline);
      const paint=await client.evaluate(`(() => {const e=document.querySelector('[data-app-shell-active-page="true"] main[data-app-shell-main-surface="default"]');return {count:document.querySelectorAll('#${STYLE_ID}').length,backgroundLoaded:getComputedStyle(e).backgroundImage.includes('data:image/'),composerColor:getComputedStyle(document.querySelector('[data-composer-body]')).backgroundColor}})()`);
      assert.equal(paint.count,1);assert.equal(paint.backgroundLoaded,true);
      // A stale document token must never mutate the already-applied style.
      await assert.rejects(()=>host.set(':root{color:red}',{documentToken:'stale',structureKey:''}),error=>error.code==='LAYOUT_CHANGED');
      assert.equal((await host.inspect()).themeStylePresent,true);
      const shot=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      await fs.writeFile(path.join(output,`${width}-applied.png`),Buffer.from(shot.data,'base64'));
      assert.equal((await sendCommand(state,'disable')).state,'disabled');
      assert.deepEqual(await client.evaluate(geometry),baseline);
      assert.equal((await host.inspect()).themeStylePresent,false);
      report.viewports.push({width,height,backgroundLoaded:true,geometryUnchanged:true,hitTestingUnchanged:true,singleStyle:true,restored:true,staleDocumentRejected:true});
    }
    await atomicJson(path.join(output,'result.json'),report);
    const validation=await readJson(path.join(root,'validation.json'));
    const key=kind==='codex'?'isolatedCodex':'isolatedChatGPT';
    const versionResults={...validation.versionResults,[identity.appVersion]:{...validation.versionResults?.[identity.appVersion],[key]:'shell-passed',lastLiveValidation:new Date().toISOString()}};
    await atomicJson(path.join(root,'validation.json'),{...validation,...(validation.appVersion===identity.appVersion?{[key]:'shell-passed'}:{}),versionResults});
    console.log(JSON.stringify(report,null,2));
  }finally{
    try{await client.send('Emulation.clearDeviceMetricsOverride');}catch{}
    try{await sendCommand(state,'apply');}catch{}
    client.close();
  }
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
