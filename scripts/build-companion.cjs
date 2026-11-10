const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto'),{buildPlugin}=require('./build-plugin.cjs');
const project=path.resolve(__dirname,'..');
const {collectReleaseFiles,copyReleaseFiles,resetBuildDirectory}=require('./release-files.cjs');
async function copyTree(source,target){const stat=await fs.lstat(source);if(stat.isSymbolicLink())throw new Error('Build refuses symbolic links');if(stat.isDirectory()){await fs.mkdir(target,{recursive:true});for(const name of await fs.readdir(source))await copyTree(path.join(source,name),path.join(target,name))}else{await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(source,target)}}
async function buildCompanion({outRoot=path.join(project,'dist/companion')}={}){
 const filesToCopy=await collectReleaseFiles({kind:'app'}),root=await resetBuildDirectory(outRoot),app=path.join(root,'app');await fs.mkdir(app,{recursive:true});
 await copyReleaseFiles(project,app,filesToCopy);
 await buildPlugin({outRoot:path.join(app,'plugins/codex-wallpaper-control')});
 await copyTree(path.join(project,'marketplace/.agents/plugins/marketplace.json'),path.join(app,'.agents/plugins/marketplace.json'));
 const files=[];async function collect(directory){for(const entry of await fs.readdir(directory,{withFileTypes:true})){const absolute=path.join(directory,entry.name),relative=path.relative(app,absolute).replaceAll('\\','/');if(relative==='install-manifest.json')continue;if(entry.isDirectory())await collect(absolute);else{if(/(^|\/)(\.state|node_modules|workshop|data|runtime|profile|cache|tokens|\.git)(\/|$)/.test(relative)||relative.endsWith('.pkg'))throw new Error('Private payload rejected');const data=await fs.readFile(absolute);files.push({path:relative,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')})}}}await collect(app);
 await fs.writeFile(path.join(app,'install-manifest.json'),JSON.stringify({schemaVersion:1,product:'CodexWallpaper',version:require('../package.json').version,files},null,2));
 await fs.writeFile(path.join(root,'Install.ps1'),"$ErrorActionPreference='Stop'\n& (Join-Path $PSScriptRoot 'app/scripts/install-integrated.ps1') -SourceRoot (Join-Path $PSScriptRoot 'app')\n");
 await fs.writeFile(path.join(root,'安裝CodexWallpaper.cmd'),'@echo off\r\nwhere pwsh.exe >nul 2>nul\r\nif errorlevel 1 (echo PowerShell 7.4 or newer is required. & pause & exit /b 1)\r\npwsh.exe -NoProfile -File "%~dp0Install.ps1"\r\nif errorlevel 1 pause\r\n');return root;
}
if(require.main===module)buildCompanion().then(result=>console.log(result)).catch(e=>{console.error(e.message);process.exitCode=1});
module.exports={buildCompanion};
