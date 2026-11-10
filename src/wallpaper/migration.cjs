const fs=require('node:fs/promises'),path=require('node:path');
const {readJson,atomicJson}=require('../config.cjs');
const {defaults,validateSettings}=require('./schema.cjs');
const {createStore}=require('./store.cjs');
const {createHash}=require('node:crypto');
async function optional(file){try{return await readJson(file)}catch(e){if(e.code==='ENOENT')return null;throw e}}
async function captureLegacyStatus({projectRoot,dataRoot}){
  try{await fs.access(path.join(dataRoot,'user-settings.json'));return}catch(e){if(e.code!=='ENOENT')throw e}
  const status=await optional(path.join(projectRoot,'.state/status.json'));if(!status)return;
  const backup=path.join(dataRoot,'migration');await fs.mkdir(backup,{recursive:true});try{await fs.writeFile(path.join(backup,'status.json'),JSON.stringify(status,null,2),{flag:'wx'})}catch(e){if(e.code!=='EEXIST')throw e}
}
async function migrateLegacy({projectRoot,dataRoot,resolveSelection}){
  const store=createStore(dataRoot);
  try{await fs.access(path.join(dataRoot,'user-settings.json'));return await store.load()}catch(e){if(e.code!=='ENOENT')throw e}
  const config=await optional(path.join(projectRoot,'config.json')),scene=await optional(path.join(projectRoot,'scene.json')),status=await optional(path.join(dataRoot,'migration/status.json'))||await optional(path.join(projectRoot,'.state/status.json'));
  const settings=defaults();
  if(typeof status?.enabled==='boolean')settings.enabled=status.enabled;
  if(config){
    settings.reading.scrim=config.overlayOpacity;settings.reading.x=config.positionX;settings.reading.offsetX=-64;
    if(config.palette)settings.colors.palette=config.palette;
  }
  settings.colors.enabled=false;
  const selectedScene=status?.sceneSelected??scene?.enabled;
  const source=selectedScene&&scene?{kind:'scene',directory:scene.wallpaperDirectory}:config?{kind:'image',file:path.resolve(projectRoot,config.backgroundPath)}:null;
  if(source){
    try{
      const resolved=await resolveSelection(source);
      settings.wallpaper.selectedId=typeof resolved==='string'?resolved:resolved?.id;
      if(!settings.wallpaper.selectedId)throw new Error('原桌布參照無法解析');
      if(resolved&&typeof resolved==='object'&&resolved.roots)settings.library.roots=resolved.roots;
    }catch(e){
      // Keep an explicit unresolved ID so disabled users can still open the recovery UI.
      settings.wallpaper.selectedId='missing:'+createHash('sha256').update(JSON.stringify(source)).digest('hex').slice(0,24);
      await atomicJson(path.join(dataRoot,'migration/selection-error.json'),{source,error:e.message});
    }
  }
  if(scene)for(const key of ['renderFps','displayFps','width','height','pauseWhenHidden'])if(scene[key]!==undefined)settings.playback[key]=scene[key];
  if(scene&&(scene.width!==undefined||scene.height!==undefined))settings.performance.resolutionMode='manual';
  validateSettings(settings);
  const backup=path.join(dataRoot,'migration');await fs.mkdir(backup,{recursive:true});
  for(const [name,data]of [['config.json',config],['scene.json',scene],['status.json',status],['legacy-palette.json',config?.palette]])if(data!==null&&data!==undefined){try{await fs.writeFile(path.join(backup,name),JSON.stringify(data,null,2),{flag:'wx'})}catch(e){if(e.code!=='EEXIST')throw e}}
  await store.save(settings);await atomicJson(path.join(backup,'completed.json'),{schemaVersion:1,at:new Date().toISOString()});return settings;
}
module.exports={migrateLegacy,captureLegacyStatus};
