const {createStoredController}=require('./stored-controller.cjs'),{createCommandHandler}=require('../wallpaper/commands.cjs');
const {defaults,mergeSettings}=require('../wallpaper/schema.cjs'),{sanitizeRendering}=require('../renderer/metrics.cjs');
async function createAppearanceService({store,library,presets,chooseFile,rendererService}){
 const stored=await createStoredController(store),handlers=new Map();let active=null,generation=0,tail=Promise.resolve(),closed=false,viewRevision=0,lastView='';
 const serial=work=>{const job=tail.then(()=>{if(closed)throw new Error('Appearance service closed');return work()});tail=job.catch(()=>{});return job};
 const proxy={snapshot:()=>((active||stored).snapshot())};
 for(const method of ['request','patch','select','setPaused','applyPreset','resetSection','resetAll'])proxy[method]=(...args)=>serial(async()=>{
  const target=active||stored,current=target.snapshot().settings,before=rendererService?.getPerformance?.()||current.performance;
  const next=method==='request'?args[0].performance:method==='patch'?mergeSettings(current,args[0]).performance:method==='resetAll'?defaults().performance:current.performance;
  const changed=!!(active&&rendererService&&JSON.stringify(before)!==JSON.stringify(next));
  try{if(changed)await rendererService.configure(next);const result=await target[method](...args);await store.recordSwitchChange?.(current,result.settings,method).catch(()=>{});if(changed&&result.dirty&&result.error&&args[1]?.persist!==false)await rendererService.configure(before);return result}catch(error){if(changed)await rendererService.configure(before);throw error}
 });
 proxy.clearCache=()=>serial(async()=>{if(!rendererService)throw new Error('快取服務尚未連接');return rendererService.clearCache()});
 const rendering=settings=>{if(!rendererService)return null;const source=rendererService.snapshot();return sanitizeRendering({...source,controlsAvailable:true,renderSize:active?.renderSize,cache:{...source.cache,requestedCacheEnabled:(settings||proxy.snapshot().settings).performance.cacheEnabled}})};
 async function view(){const snapshot=proxy.snapshot(),data={...snapshot,cards:library.cards(snapshot.settings),presets:await presets.list(),rendering:rendering(snapshot.settings)};delete data.revision;const key=JSON.stringify(data);if(key!==lastView){lastView=key;viewRevision++}return {...data,revision:viewRevision}}
 return {
  library,presets,controller:proxy,rendering,
  attach(controller,epoch){return serial(async()=>{if(epoch<generation)return false;const desired=stored.snapshot().settings;await rendererService?.configure(desired.performance);if(JSON.stringify(controller.snapshot().settings)!==JSON.stringify(desired))await controller.request(desired);active=controller;generation=epoch;return true})},
  detach(epoch){return serial(async()=>{if(epoch!==generation)return false;const snapshot=active?.snapshot();active=null;if(snapshot)await stored.request(snapshot.settings,{persist:!snapshot.dirty});return true})},
  async dispatch(command){
   if(closed)throw new Error('Appearance service closed');
   if(typeof command?.sessionId!=='string'||typeof command?.panelId!=='string'||command.sessionId.length>128||command.panelId.length>128)throw new Error('Invalid panel identity');
   const key=command.sessionId+':'+command.panelId;if(!handlers.has(key)){if(handlers.size>=32)throw new Error('Too many panel clients');handlers.set(key,createCommandHandler({sessionId:command.sessionId,panelId:command.panelId,controller:proxy,library,presets,chooseFile,clearCache:()=>proxy.clearCache()}))}
   const reply=await handlers.get(key).dispatch(command);if(reply.state)reply.state=await view();return reply;
  },
  view,
  async close(){for(const handler of handlers.values())handler.close();handlers.clear();await tail;closed=true;await stored.close()}
 };
}
module.exports={createAppearanceService};
