const {resolvePaths}=require('./paths.cjs'),{migrateData}=require('./migration.cjs');
const {ensureSettingsV2}=require('../wallpaper/settings-migration.cjs');
async function main(){const args=process.argv.slice(2),value=key=>args[args.indexOf(key)+1];if(!args.includes('--root'))throw new Error('Root required');const paths=resolvePaths({installRoot:value('--root')}),result=await migrateData({legacyRoot:args.includes('--legacy')?value('--legacy'):undefined,paths});await ensureSettingsV2(paths.data);return result}
if(require.main===module)main().then(value=>console.log(JSON.stringify(value))).catch(()=>{console.error('SETTINGS_INVALID');process.exitCode=1});
module.exports={main};
