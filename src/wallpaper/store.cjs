const path=require('node:path');
const {atomicJson}=require('../config.cjs');
const {defaults,validateSettings,upgradeSettings}=require('./schema.cjs');
const {readRawSettings,backupLegacySettings,settingsLock}=require('./settings-migration.cjs');
function createStore(root){
  const file=path.join(root,'user-settings.json');
  return {
    async recordSwitchChange(before,after,source){
      if(before.enabled===after.enabled&&before.wallpaper.enabled===after.wallpaper.enabled)return;
      const fs=require('node:fs/promises'),file=path.join(root,'switch-history.json');let entries=[];
      try{const saved=JSON.parse(await fs.readFile(file,'utf8'));if(Array.isArray(saved))entries=saved.slice(-49)}catch{}
      entries.push({at:new Date().toISOString(),source,previous:{enabled:before.enabled,wallpaperEnabled:before.wallpaper.enabled},next:{enabled:after.enabled,wallpaperEnabled:after.wallpaper.enabled}});await atomicJson(file,entries);
    },
    async load(){const record=await readRawSettings(root);return record?upgradeSettings(record.raw):defaults()},
    save(value){let next;try{next=validateSettings(value)}catch(e){return Promise.reject(e)}return settingsLock(root,async()=>{await backupLegacySettings(root,await readRawSettings(root));await atomicJson(file,next);return structuredClone(next)})}
  };
}
module.exports={createStore};
