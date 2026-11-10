const fs=require('node:fs/promises'),path=require('node:path');
const project=path.resolve(__dirname,'..');
const privateParts=new Set(['.git','.state','node_modules','dist','workshop','data','runtime','profile','cache','tokens','logs']);
function isReleaseFile(relative){
  const parts=relative.replaceAll('\\','/').split('/'),name=parts.at(-1).toLowerCase();
  return !parts.some(p=>privateParts.has(p.toLowerCase())||p==='..'||!p)&&!name.startsWith('.env')&&!/\.(pkg|log|tmp|lnk)$/i.test(name);
}
const appFiles=['package.json','wallpaper.defaults.json','config.json','README.md','VALIDATION.md','THIRD_PARTY.md','validation.json'];
const sourceFiles=['package-lock.json','.gitignore','.gitattributes','Theme.ps1','啟動CodexWallpaper.cmd','安裝獨立桌布插件.cmd','原版套用初音主題.cmd','啟動初音主題.cmd','還原外觀.cmd'];
async function collectReleaseFiles({sourceRoot=project,kind='source'}={}){
  if(!['source','app'].includes(kind))throw new Error('Unknown release kind');
  const files=[];
  async function visit(relative){
    if(!isReleaseFile(relative))return;
    const file=path.join(sourceRoot,relative),stat=await fs.lstat(file);
    if(stat.isSymbolicLink())throw new Error('Release refuses symbolic links: '+relative);
    if(stat.isDirectory()){for(const name of (await fs.readdir(file)).sort())await visit(relative+'/'+name)}
    else if(stat.isFile())files.push(relative);
  }
  for(const name of [...appFiles,'src','scripts','assets','docs',...(kind==='source'?[...sourceFiles,'plugins','marketplace','test','.github']:[])])await visit(name);
  return files.sort();
}
async function copyReleaseFiles(sourceRoot,target,files){
  for(const relative of files){if(!isReleaseFile(relative))throw new Error('Private payload rejected');const destination=path.join(target,relative);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.copyFile(path.join(sourceRoot,relative),destination)}
}
// Destructive cleanup is confined to generated subdirectories, after checking
// every existing ancestor. Never clean the source root or follow a junction.
async function resetBuildDirectory(target){
  const resolved=path.resolve(target),relative=path.relative(project,resolved),parts=relative.split(path.sep);
  if(!['dist','.state'].includes(parts[0])||parts.length<2||parts.some(p=>!p||p==='..'))throw new Error('Build output must be a generated subdirectory');
  let current=project;
  for(const part of parts){current=path.join(current,part);try{if((await fs.lstat(current)).isSymbolicLink())throw new Error('Build refuses linked output')}catch(error){if(error.code!=='ENOENT')throw error}}
  await fs.rm(resolved,{recursive:true,force:true});await fs.mkdir(resolved,{recursive:true});return resolved;
}
async function exportSource(outRoot){
  const files=await collectReleaseFiles(),output=await resetBuildDirectory(outRoot);
  await copyReleaseFiles(project,output,files);return {output,files:files.length};
}
if(require.main===module){const [action,target]=process.argv.slice(2);(action==='export'&&target?exportSource(target):action==='list'?collectReleaseFiles():Promise.reject(new Error('Use list or export <generated directory>'))).then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(error.message);process.exitCode=1})}
module.exports={collectReleaseFiles,copyReleaseFiles,isReleaseFile,resetBuildDirectory,exportSource};
