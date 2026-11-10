// Only exercise our own injected control in a managed isolated app.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {connectManaged}=require('../src/cli.cjs');
const {TOGGLE_ID}=require('../src/theme-toggle.cjs');
const {STYLE_ID}=require('../src/style-host.cjs');
const {delay}=require('../src/control.cjs');
const root=path.resolve(__dirname,'..');
async function main(){
  const {client,identity}=await connectManaged(path.join(root,'.state/session.json'));
  assert.equal(identity.mode,'Isolated');
  const output=path.join(root,'.state/validation',`${identity.sessionId}-toggle`);await fs.mkdir(output,{recursive:true});
  const inspect=()=>client.evaluate(`(() => {const b=document.getElementById('${TOGGLE_ID}');const main=document.querySelector('[data-app-shell-active-page="true"] main');const r=b?.getBoundingClientRect();return {count:document.querySelectorAll('#${TOGGLE_ID}').length,checked:b?.getAttribute('aria-checked'),busy:b?.disabled,style:!!document.getElementById('${STYLE_ID}'),image:!!main&&getComputedStyle(main).backgroundImage.includes('data:image/'),hit:!!b&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b};})()`);
  const geometry=()=>client.evaluate(`[...document.querySelectorAll('[data-app-shell-active-page="true"] main[data-app-shell-main-surface="default"],.app-shell-left-panel,[data-app-shell-active-page="true"] [data-composer-body]')].filter(e=>e.checkVisibility()).map(e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]})`);
  async function wait(on){for(let i=0;i<60;i++){await delay(250);try{const s=await inspect();if(s.count===1&&!s.busy&&s.checked===String(on)&&s.style===on&&s.image===on&&s.hit)return s;}catch{}}throw new Error(`Toggle did not settle to ${on}: ${JSON.stringify(await inspect())}`);}
  async function click(){await client.evaluate(`document.getElementById('${TOGGLE_ID}').click()`);}
  const report={appVersion:identity.appVersion,mode:identity.mode,viewports:[],sentMessages:false};
  try{
    for(const [width,height]of [[1280,720],[1536,816]]){
      await client.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await wait(true);const before=await geometry();
      await click();await wait(false);assert.deepEqual(await geometry(),before);
      // The daemon must not reapply a theme the user turned off.
      await delay(1600);await wait(false);
      await client.send('Page.reload');await wait(false);
      await click();await wait(true);assert.deepEqual(await geometry(),before);
      const shot=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      await fs.writeFile(path.join(output,`${width}-toggle.png`),Buffer.from(shot.data,'base64'));
      report.viewports.push({width,height,offRestores:true,buttonRemains:true,offSurvivesReload:true,onReapplies:true,singleButton:true,clickable:true,geometryUnchanged:true});
    }
    await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  }finally{await client.send('Emulation.clearDeviceMetricsOverride').catch(()=>{});client.close();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
