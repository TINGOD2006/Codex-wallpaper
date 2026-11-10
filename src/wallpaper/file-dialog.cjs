const {execFile}=require('node:child_process'),{promisify}=require('node:util'),path=require('node:path');
const run=promisify(execFile);
async function chooseFile({kind,ownerPid=0}){
  if(!['imageVideo','folder','presetOpen','presetSave'].includes(kind)||!Number.isInteger(ownerPid)||ownerPid<0)throw new Error('Invalid file dialog');
  const {stdout}=await run(process.env.MIKU_PWSH||'pwsh',['-NoProfile','-STA','-File',path.resolve(__dirname,'../../scripts/wallpaper-file-dialog.ps1'),'-Action',kind,'-OwnerProcessId',String(ownerPid)],{windowsHide:true,timeout:300000,maxBuffer:65536});
  const result=JSON.parse(stdout.replace(/^\uFEFF/,''));if(typeof result.cancelled!=='boolean'||(!result.cancelled&&typeof result.path!=='string'))throw new Error('Invalid picker result');return result;
}
module.exports={chooseFile};
