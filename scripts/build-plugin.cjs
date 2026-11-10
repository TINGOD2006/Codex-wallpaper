const fs=require('node:fs/promises'),path=require('node:path'),esbuild=require('esbuild');
const project=path.resolve(__dirname,'..'),source=path.join(project,'plugins/codex-wallpaper-control');
const {resetBuildDirectory}=require('./release-files.cjs');
async function buildPlugin({outRoot=path.join(project,'dist/plugin/codex-wallpaper-control')}={}){
 const output=await resetBuildDirectory(outRoot);
 await fs.mkdir(path.join(output,'dist'),{recursive:true});
 for(const name of ['plugin.json','mcp.json','.mcp.json','.codex-plugin/plugin.json','entrypoint.cjs','assets/wallpaper.svg','skills/wallpaper-control/SKILL.md']){await fs.mkdir(path.dirname(path.join(output,name)),{recursive:true});await fs.copyFile(path.join(source,name),path.join(output,name))}
 await esbuild.build({entryPoints:[path.join(source,'server.cjs')],outfile:path.join(output,'server.cjs'),bundle:true,platform:'node',format:'cjs',target:'node24',legalComments:'inline'});
 const browser=await esbuild.build({entryPoints:[path.join(source,'app.js')],bundle:true,platform:'browser',format:'esm',target:'es2022',write:false,minify:true,legalComments:'inline'});
 const html=(await fs.readFile(path.join(source,'app.html'),'utf8')).replace('<!--PLUGIN_SCRIPT-->',()=>'<script type="module">'+browser.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')+'</script>');
 await fs.writeFile(path.join(output,'dist/control.html'),html);
 const lock=JSON.parse(await fs.readFile(path.join(project,'package-lock.json'),'utf8')),notices=[];
 for(const [relative,info]of Object.entries(lock.packages||{})){
  if(!relative.startsWith('node_modules/'))continue;const folder=path.join(project,relative);let license='';
  for(const name of ['LICENSE','LICENSE.md','LICENSE.txt','license','license.md','COPYING'])try{license=await fs.readFile(path.join(folder,name),'utf8');break}catch{}
  notices.push(relative.replace(/^node_modules\//,'')+' '+info.version+' ('+(info.license||'see package')+')\n'+license);
 }
 await fs.writeFile(path.join(output,'THIRD_PARTY_NOTICES.txt'),notices.join('\n\n----------------------------------------\n\n'));
 return output;
}
if(require.main===module)buildPlugin().then(file=>console.log(file)).catch(e=>{console.error(e.message);process.exitCode=1});
module.exports={buildPlugin};
