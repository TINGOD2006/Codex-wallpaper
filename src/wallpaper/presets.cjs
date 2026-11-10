const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {atomicJson}=require('../config.cjs'),{defaults,mergeSettings,validateSettings}=require('./schema.cjs');
const groups=['wallpaper','reading','materials','colors','playback'];
function validName(name){if(typeof name!=='string'||!name.trim()||name.trim().length>64||/[\x00-\x1f\x7f]/.test(name))throw new Error('名稱須為 1–64 字元且不含控制字元');return name.trim()}
function appearance(settings){validateSettings(settings);return Object.fromEntries(groups.map(k=>[k,structuredClone(settings[k])]))}
function document(value){
 if(!value||Object.keys(value).sort().join(',')!=='appearance,name,schemaVersion'||value.schemaVersion!==1||!value.appearance||Object.keys(value.appearance).sort().join(',')!==[...groups].sort().join(','))throw new Error('無效的 Wallpaper 預設');
 const name=validName(value.name),s=mergeSettings(defaults(),value.appearance);return {schemaVersion:1,name,appearance:appearance(s)};
}
function createPresets({dataRoot,store,library}){
 const root=path.join(dataRoot,'presets');let tail=Promise.resolve();
 const serial=work=>{const job=tail.then(work);tail=job.catch(()=>{});return job};
 function file(id){if(!/^user:[\da-f-]{36}$/.test(id))throw new Error('內建預設不可修改');return path.join(root,id.slice(5)+'.json')}
 async function builtins(){
  const s=defaults(),make=(id,name,value)=>({id,builtin:true,doc:{schemaVersion:1,name,appearance:appearance(value)}});
  const normal=make('builtin:native','原生＋桌布',s);s.reading.scrim=.94;const reading=make('builtin:reading','閱讀優先',s);
  return [normal,reading];
 }
 async function read(id){
  if(id.startsWith('builtin:')){const builtin=(await builtins()).find(p=>p.id===id);if(builtin)return builtin.doc}
  const target=file(id),stat=await fs.stat(target);if(stat.size>2*1024*1024)throw new Error('預設超過 2 MiB');
  return document(JSON.parse((await fs.readFile(target,'utf8')).replace(/^\uFEFF/,'')));
 }
 async function saveDoc(doc){const id='user:'+randomUUID();await atomicJson(file(id),document(doc));return {id,name:doc.name,builtin:false}}
 return {
  async list(){
   const all=await builtins();let names=[];try{names=await fs.readdir(root)}catch(e){if(e.code!=='ENOENT')throw e}
   for(const name of names.filter(n=>/^[\da-f-]{36}\.json$/.test(n)))try{const id='user:'+name.slice(0,-5);all.push({id,builtin:false,doc:await read(id)})}catch{}
   return all.map(p=>({id:p.id,name:p.doc.name,builtin:p.builtin,missing:!!p.doc.appearance.wallpaper.selectedId&&!library.get(p.doc.appearance.wallpaper.selectedId)}));
  },
  save(name,settings){return serial(()=>saveDoc({schemaVersion:1,name:validName(name),appearance:appearance(settings)}))},
  rename(id,name){return serial(async()=>{const target=file(id),doc=await read(id);doc.name=validName(name);await atomicJson(target,doc);return {id,name:doc.name}})},
  remove(id){return serial(()=>fs.unlink(file(id)))},
  async resolve(id){const doc=await read(id),current=await store.load(),a=structuredClone(doc.appearance);if(id.startsWith('builtin:'))a.wallpaper.selectedId=current.wallpaper.selectedId;const next=mergeSettings(current,a);next.enabled=true;next.presets.activeId=id;return next},
  importFile(source){return serial(async()=>{const stat=await fs.stat(source);if(stat.size>2*1024*1024)throw new Error('預設超過 2 MiB');return saveDoc(document(JSON.parse((await fs.readFile(source,'utf8')).replace(/^\uFEFF/,''))))})},
  async exportFile(id,target){const doc=await read(id);await atomicJson(target,doc);return {exported:true}}
 };
}
module.exports={createPresets};
