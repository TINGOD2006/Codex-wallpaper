const {mergeSettings}=require('./schema.cjs');
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
function exact(value,required,optional=[]){if(!plain(value)||required.some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>![...required,...optional].includes(k)))throw new Error('無效的操作欄位')}
function id(value){if(typeof value!=='string'||!value||value.length>256||/[\x00-\x1f]/.test(value))throw new Error('無效的識別碼');return value}
function isRootContext(context,frame){return frame?.url==='app://-/index.html'&&context?.origin===frame.securityOrigin&&context.auxData?.isDefault===true&&context.auxData.frameId===frame.id}
function createCommandHandler({sessionId,panelId,controller,library,presets,chooseFile,clearCache}){
 let last=0,closed=false,settingsIntent=0;const cache=new Map();
 const state=async()=>({...controller.snapshot(),cards:library.cards(controller.snapshot().settings),presets:await presets.list()});
 async function execute(action,p,sequence){
  const markSettings=()=>{settingsIntent=Math.max(settingsIntent,sequence)};
  switch(action){
   case 'settings.patch':exact(p,['patch'],['persist']);if(!plain(p.patch)||Object.keys(p.patch).some(k=>!['enabled','wallpaper','reading','materials','colors','playback','performance'].includes(k))||(p.persist!==undefined&&typeof p.persist!=='boolean'))throw new Error('此設定不可由面板修改');mergeSettings(controller.snapshot().settings,p.patch);markSettings();await controller.patch(p.patch,{persist:p.persist!==false});break;
   case 'renderer.cache.clear':exact(p,[]);if(typeof clearCache!=='function')throw new Error('快取服務尚未連接');await clearCache();break;
   case 'wallpaper.select':exact(p,['id']);id(p.id);markSettings();await controller.select(p.id);break;
   case 'library.refresh':exact(p,[]);await library.scan();break;
   case 'library.thumbnail':exact(p,['id']);id(p.id);return {thumbnail:await library.thumbnail(p.id),id:p.id};
   case 'library.favorite':case 'library.hide':{
    exact(p,['id','value']);id(p.id);if(typeof p.value!=='boolean'||!library.get(p.id))throw new Error('無效的桌布');const key=action==='library.favorite'?'favorites':'hidden',values=new Set(controller.snapshot().settings.library[key]);p.value?values.add(p.id):values.delete(p.id);markSettings();await controller.patch({library:{[key]:[...values]}});break;
   }
   case 'library.import':case 'library.addRoot':case 'presets.import':{
    exact(p,[]);const kind=action==='library.import'?'imageVideo':action==='library.addRoot'?'folder':'presetOpen',picked=await chooseFile({kind});if(picked.cancelled)return {cancelled:true};
    if(action==='library.import')await library.importFile(picked.path);else if(action==='library.addRoot'){const roots=await library.addRoot(picked.path);await controller.patch({library:{roots}})}else await presets.importFile(picked.path);break;
   }
   case 'playback.pause':exact(p,['paused']);if(typeof p.paused!=='boolean')throw new Error('無效的暫停值');markSettings();await controller.setPaused(p.paused);break;
   case 'presets.save':exact(p,['name']);await presets.save(p.name,controller.snapshot().settings);break;
   case 'presets.apply':{exact(p,['id']);id(p.id);markSettings();const value=await presets.resolve(p.id);if(closed||settingsIntent!==sequence)return {superseded:true};await controller.applyPreset(value);break}
   case 'presets.rename':exact(p,['id','name']);id(p.id);await presets.rename(p.id,p.name);break;
   case 'presets.delete':exact(p,['id']);id(p.id);await presets.remove(p.id);break;
   case 'presets.export':{exact(p,['id']);id(p.id);const picked=await chooseFile({kind:'presetSave'});if(picked.cancelled)return {cancelled:true};await presets.exportFile(p.id,picked.path);break}
   case 'reset.section':exact(p,['section']);if(!['reading','materials','colors','playback'].includes(p.section))throw new Error('無效的分頁');markSettings();await controller.resetSection(p.section);break;
   case 'reset.all':exact(p,[]);markSettings();await controller.resetAll();break;
   default:throw new Error('不支援的操作');
  }
  return {};
 }
 return {
  close(){closed=true;cache.clear()},
  async dispatch(command){
   const reply={sessionId,panelId,seq:command?.seq,ok:false};
   try{
    exact(command,['sessionId','panelId','seq','action','payload']);
    if(closed||command.sessionId!==sessionId||command.panelId!==panelId||!Number.isSafeInteger(command.seq)||command.seq<1||typeof command.action!=='string'||JSON.stringify(command).length>65536)throw new Error('過期或無效的面板操作');
    const fingerprint=JSON.stringify(command),cached=cache.get(command.seq);if(cached){if(cached.fingerprint!==fingerprint)throw new Error('序號已由其他操作使用');return cached.promise}
    if(command.seq<=last)throw new Error('操作已過期');last=command.seq;
    const promise=(async()=>{try{const extra=await execute(command.action,command.payload,command.seq);if(closed)throw new Error('面板已關閉');return {...reply,ok:true,...extra,...(command.action==='library.thumbnail'?{}:{state:await state()})}}catch(e){return {...reply,error:e.message,...(!closed?{state:await state().catch(()=>undefined)}:{})}}})();
    cache.set(command.seq,{fingerprint,promise});if(cache.size>256)cache.delete(cache.keys().next().value);return promise;
   }catch(e){return {...reply,error:e.message}}
  }
 };
}
module.exports={createCommandHandler,isRootContext};
