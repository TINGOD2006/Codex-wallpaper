const path=require('node:path');
function resolvePaths(options={}){
 const environment=options.environment||process.env;let candidate=options.installRoot||environment.CODEX_WALLPAPER_ROOT;
 if(!candidate&&Object.hasOwn(options,'localAppData')){if(typeof options.localAppData!=='string'||!options.localAppData)throw new Error('Local app data required');candidate=path.join(options.localAppData,'CodexWallpaper')}
 if(!candidate){if(!environment.USERPROFILE)throw new Error('User profile required');candidate=path.join(environment.USERPROFILE,'.codex-wallpaper')}
 const root=path.resolve(candidate);
 return Object.fromEntries([['root',root],...['app','data','runtime','logs'].map(name=>[name,path.join(root,name)])]);
}
module.exports={resolvePaths};
