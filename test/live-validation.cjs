// Explicit live validation: only the loader's own isolated instance is accepted.
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {connectManaged}=require('../src/cli.cjs');
const {readJson,atomicJson,saveConfig}=require('../src/config.cjs');
const {sendCommand,delay}=require('../src/control.cjs');
const {structureExpression}=require('../src/adapters.cjs');
const {STYLE_ID}=require('../src/style-host.cjs');
const root=path.resolve(__dirname,'..'),state=path.join(root,'.state');
const identityFile=path.join(state,'session.json'),configFile=path.join(root,'config.json');
const geometryExpression=`(() => [...document.querySelectorAll('button,input,textarea,a')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0}).map(e=>{const r=e.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {tag:e.tagName,rect:[r.x,r.y,r.width,r.height],hit:e===hit||e.contains(hit)}}))()`;
async function main() {
  const identity=await readJson(identityFile);assert.equal(identity.mode,'Isolated','Live validation requires an isolated instance');
  const original=await readJson(configFile);
  const {client}=await connectManaged(identityFile);
  const output=path.join(state,'validation',identity.sessionId);await fs.mkdir(output,{recursive:true});
  const report={appVersion:identity.appVersion,mode:'Isolated',layout:'login',viewports:[],manualChecks:{codex:'not-tested',chatgpt:'not-tested',existingProfile:'not-tested'}};
  async function inspect(){return client.evaluate(`(() => {const s=document.querySelectorAll('#${STYLE_ID}');const c=document.querySelector('#root > .zoom-adjusted-viewport:not(.pointer-events-none)');return {styleCount:s.length,backgroundLoaded:!!c&&getComputedStyle(c).backgroundImage.includes('data:image/')}})()`);}
  async function capture(name){const shot=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});const bytes=Buffer.from(shot.data,'base64');await fs.writeFile(path.join(output,name),bytes);return createHash('sha256').update(bytes).digest('hex');}
  try {
    for(const [width,height]of [[1280,720],[1536,816]]) {
      await client.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await sendCommand(state,'disable');
      const structure=await client.evaluate(structureExpression);assert.equal(structure.editorCount,0,'Do not run fixed-login tests after signing in');
      const baselineGeometry=await client.evaluate(geometryExpression);
      const before=await capture(`${width}-before.png`);
      assert.equal((await sendCommand(state,'apply')).state,'applied');
      assert.equal((await sendCommand(state,'apply')).state,'applied');
      const paint=await inspect();assert.equal(paint.styleCount,1);assert.equal(paint.backgroundLoaded,true);
      assert.deepEqual(await client.evaluate(geometryExpression),baselineGeometry);
      const applied=await capture(`${width}-applied.png`);assert.notEqual(applied,before);
      await saveConfig(configFile,{overlayOpacity:.78});
      assert.equal((await sendCommand(state,'apply')).state,'applied');assert.equal((await inspect()).styleCount,1);
      await atomicJson(configFile,original);
      assert.equal((await sendCommand(state,'disable')).state,'disabled');assert.equal((await inspect()).styleCount,0);
      const restored=await capture(`${width}-restored.png`);assert.equal(restored,before,'Fixed login view should restore pixel-identically');
      report.viewports.push({width,height,backgroundLoaded:true,geometryUnchanged:true,hitTestingUnchanged:true,singleStyleAfterRepeatedApply:true,pixelIdenticalRestore:true,beforeSha256:before,appliedSha256:applied,restoredSha256:restored});
    }
    await sendCommand(state,'apply');await client.send('Page.reload');
    let restoredAfterReload=false;
    for(let i=0;i<40;i++){await delay(250);try{const painted=await inspect();if(painted.styleCount===1&&painted.backgroundLoaded){restoredAfterReload=true;break;}}catch{}}
    assert.equal(restoredAfterReload,true,'Theme did not return after page reload');report.reappliedAfterReload=true;
    assert.equal((await sendCommand(state,'disable')).state,'disabled');
    await client.send('Emulation.clearDeviceMetricsOverride');
    await atomicJson(path.join(output,'result.json'),report);
    const validation=await readJson(path.join(root,'validation.json'));
    await atomicJson(path.join(root,'validation.json'),{...validation,isolatedLogin:'passed',lastLiveValidation:new Date().toISOString(),resultPath:path.relative(root,path.join(output,'result.json'))});
    console.log(JSON.stringify(report,null,2));
  } finally {
    await atomicJson(configFile,original);
    try{await sendCommand(state,'disable');}catch{}
    try{await client.send('Emulation.clearDeviceMetricsOverride');}catch{}
    client.close();
  }
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
