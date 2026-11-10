const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=process.env.CODEX_WALLPAPER_ROOT||(process.env.USERPROFILE&&path.join(process.env.USERPROFILE,'.codex-wallpaper'));
const installed=root&&path.join(root,'app/plugins/codex-wallpaper-control/server.cjs');
const server=installed&&fs.existsSync(installed)?installed:path.join(__dirname,'server.cjs');
const child=spawn(process.execPath,[server],{windowsHide:true,stdio:'inherit'});
child.on('error',()=>{process.stderr.write('Wallpaper control could not start\n');process.exitCode=1});child.on('exit',code=>{process.exitCode=code||0});
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>child.kill());
