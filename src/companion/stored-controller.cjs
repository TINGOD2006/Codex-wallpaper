const {defaults,validateSettings,mergeSettings}=require('../wallpaper/schema.cjs');
async function createStoredController(store){
 let settings=await store.load(),desired=structuredClone(settings),revision=0,dirty=false,error=null,tail=Promise.resolve();
 const controller={
  snapshot(){return structuredClone({settings,playback:{state:'off',selectedId:settings.wallpaper.selectedId,pendingId:null},revision,dirty,error})},
  async request(value,{persist=true}={}){
   const next=validateSettings(value);desired=structuredClone(next);
   const job=tail.then(async()=>{settings=next;revision++;dirty=true;error=null;if(persist)try{await store.save(next);dirty=false}catch(e){error='未儲存：'+e.message}return controller.snapshot()});tail=job.catch(()=>{});return job;
  },
  async patch(patch,options){return controller.request(mergeSettings(desired,patch),options)},
  select(id){return controller.patch({wallpaper:{selectedId:id,enabled:true}})},
  setPaused(paused){return controller.patch({playback:{paused}})},
  applyPreset(value){return controller.request({...value,performance:structuredClone(desired.performance)})},
  resetSection(name){const d=defaults();if(!['reading','materials','colors','playback'].includes(name))return Promise.reject(new Error('Invalid reset section'));return controller.patch(name==='materials'?{materials:d.materials,colors:d.colors}:{[name]:d[name]})},
  resetAll(){const d=defaults();d.enabled=false;d.wallpaper.selectedId=settings.wallpaper.selectedId;d.library=structuredClone(settings.library);return controller.request(d)},
  async close(){await tail}
 };return controller;
}
module.exports={createStoredController};
