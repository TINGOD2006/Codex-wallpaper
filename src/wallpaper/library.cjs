const fs=require('node:fs/promises'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const {atomicJson,loadImage}=require('../config.cjs');
const {createThumbnailer,createPosterCache,createThumbnailQueue}=require('./thumbnails.cjs');
const run=promisify(execFile),hash=s=>createHash('sha256').update(s.toLowerCase()).digest('hex').slice(0,16);
const videoExtensions=new Set(['.mp4','.webm','.m4v','.mov','.mkv','.ogv']);
async function real(file){return fs.realpath(file)}
function within(base,file){return file===base||file.toLowerCase().startsWith(base.toLowerCase()+path.sep)}
async function safeFile(base,name){if(typeof name!=='string'||!name||path.isAbsolute(name)||name.split(/[\\/]/).some(s=>s==='..'||s==='.')||name.includes('\0'))throw new Error('Resource path rejected');const file=await real(path.join(base,name));if(!within(base,file)||!(await fs.stat(file)).isFile())throw new Error('Resource outside project');return file}
async function readMetadata(file){
  const limit=1024*1024,handle=await fs.open(file,'r');
  const oversized=()=>Object.assign(new Error('Project metadata exceeds 1 MiB'),{code:'METADATA_TOO_LARGE'});
  try{
    if((await handle.stat()).size>limit)throw oversized();
    const bytes=Buffer.alloc(limit+1);let length=0;
    while(length<bytes.length){const read=await handle.read(bytes,length,Math.min(65536,bytes.length-length),length);if(!read.bytesRead)break;length+=read.bytesRead}
    if(length>limit)throw oversized();return JSON.parse(bytes.toString('utf8',0,length).replace(/^\uFEFF/,''));
  }finally{await handle.close()}
}
async function discoverSteamRoots(){
  let steam=path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Steam');
  if(process.platform==='win32')try{const {stdout}=await run(process.env.MIKU_PWSH||'pwsh',['-NoProfile','-Command',"(Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Valve\\Steam' -ErrorAction SilentlyContinue).SteamPath"],{windowsHide:true,timeout:5000});if(stdout.trim())steam=stdout.trim()}catch{}
  const libraries=[steam];try{const text=await fs.readFile(path.join(steam,'steamapps/libraryfolders.vdf'),'utf8');for(const m of text.matchAll(/"path"\s*"([^"\r\n]+)"/g))libraries.push(m[1].replace(/\\\\/g,'\\'))}catch{}
  const roots=[];for(const lib of libraries)try{const candidate=await real(path.join(lib,'steamapps/workshop/content/431960'));if(!roots.some(p=>p.toLowerCase()===candidate.toLowerCase()))roots.push(candidate)}catch{}return roots;
}
function createLibrary({roots=[],dataRoot,runtimeRoot,renderPoster}){
  let entries=new Map(),sortedEntries=[],scanTask=null,closed=false,diagnostics=[];const imports=path.join(dataRoot,'imports'),queue=createThumbnailQueue(),thumbnail=createThumbnailer({dataRoot,queue}),poster=createPosterCache({dataRoot,queue,runtimeRoot,renderPoster});
  async function project(base,dir,managed=false){
    try{
      if(closed)return null;const directory=await real(dir);if(!within(base,directory))return null;
      const metadata=await readMetadata(await safeFile(directory,'project.json'));
      const kind=String(metadata.type||'').toLowerCase();if(!['scene','video','image','web','application'].includes(kind))return null;
      const id=managed&&/^[\da-f-]{36}$/.test(metadata.importId||'')?'local:'+metadata.importId:'steam:'+hash(base)+':'+(String(metadata.workshopid||'').match(/^\d+$/)?.[0]||path.basename(directory));
      const entry={id,kind,title:String(metadata.title||path.basename(dir)).slice(0,300),rootId:hash(base),directory,mediaPath:null,previewPath:null,contentRating:typeof metadata.contentrating==='string'?metadata.contentrating:'unknown',capability:'unsupported',reason:'此類型尚未支援'};
      try{entry.mediaPath=await safeFile(directory,kind==='scene'?'scene.pkg':metadata.file);if(['image','scene'].includes(kind)||(kind==='video'&&videoExtensions.has(path.extname(entry.mediaPath).toLowerCase()))){entry.capability='supported';delete entry.reason}}catch{entry.reason='找不到有效的本機資源'}
      try{if(metadata.preview)entry.previewPath=await safeFile(directory,metadata.preview);else if(kind==='image')entry.previewPath=entry.mediaPath}catch{}
      return entry;
    }catch(e){if(e.code==='METADATA_TOO_LARGE')diagnostics.push({code:e.code,project:path.basename(dir)});return null}
  }
  async function scan(){
    if(closed)return [];
    if(scanTask)return scanTask;
    scanTask=(async()=>{
      const found=new Map(),seen=new Set();diagnostics=[];
      for(const requested of [...roots,imports]){if(closed)break;
        let base;try{base=await real(requested)}catch{continue}const key=base.toLowerCase();if(seen.has(key))continue;seen.add(key);
        const direct=await project(base,base,base===await real(imports).catch(()=>''));if(direct){found.set(direct.id,direct);continue}
        let dirs;try{dirs=(await fs.readdir(base,{withFileTypes:true})).filter(d=>d.isDirectory()).slice(0,10000)}catch{continue}
        for(let i=0;!closed&&i<dirs.length;i+=8){const batch=await Promise.all(dirs.slice(i,i+8).map(d=>project(base,path.join(base,d.name),key===path.resolve(imports).toLowerCase())));for(const entry of batch)if(entry)found.set(entry.id,entry)}
      }
      const builtin=path.resolve(__dirname,'../../assets/miku-background.png');try{await fs.access(builtin);found.set('builtin:miku',{id:'builtin:miku',kind:'image',title:'初音靜態插畫',rootId:'builtin',directory:path.dirname(builtin),mediaPath:builtin,previewPath:builtin,contentRating:'Everyone',capability:'supported'})}catch{}
      if(!closed){entries=found;sortedEntries=[...found.values()].sort((a,b)=>a.title.localeCompare(b.title))}return [...entries.values()];
    })().finally(()=>{scanTask=null});return scanTask;
  }
  return {
    scan,get:id=>entries.get(id)||null,diagnostics:()=>structuredClone(diagnostics),async close(){closed=true;await queue.close();await scanTask},
    cards(settings){
      const favorites=new Set(settings.library.favorites),hidden=new Set(settings.library.hidden),first=[],rest=[];
      for(const e of sortedEntries){const favorite=favorites.has(e.id);(favorite?first:rest).push({id:e.id,kind:e.kind,title:e.title,contentRating:e.contentRating,capability:e.capability,reason:e.reason,favorite,hidden:hidden.has(e.id),selected:settings.wallpaper.selectedId===e.id})}
      return first.concat(rest);
    },
    async importFile(file){
      if(closed)throw new Error('Wallpaper library is closed');
      const source=await real(file),stat=await fs.stat(source),extension=path.extname(source).toLowerCase();let kind;
      if(videoExtensions.has(extension)){
        if(stat.size>1024**3)throw new Error('Video exceeds 1 GiB');const handle=await fs.open(source,'r'),header=Buffer.alloc(32);try{await handle.read(header,0,32,0)}finally{await handle.close()}
        if(header.toString('ascii',4,8)!=='ftyp'&&!header.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))&&header.toString('ascii',0,4)!=='OggS')throw new Error('Invalid video container');kind='video';
      }else{await loadImage(source);kind='image'}
      const importId=randomUUID(),dir=path.join(imports,importId),name='media'+extension;await fs.mkdir(dir,{recursive:true});await fs.copyFile(source,path.join(dir,name));await atomicJson(path.join(dir,'project.json'),{type:kind,file:name,title:path.basename(source),importId,contentrating:'unknown'});await scan();return entries.get('local:'+importId);
    },
    async addRoot(root){if(closed)throw new Error('Wallpaper library is closed');const resolved=await real(root);if(!(await fs.stat(resolved)).isDirectory())throw new Error('Not a directory');if(!roots.some(r=>path.resolve(r).toLowerCase()===resolved.toLowerCase()))roots.push(resolved);await scan();return [...roots]},
    async thumbnail(id){
      if(closed)return null;
      const entry=entries.get(id);if(!entry)return null;
      if(entry.previewPath){const checked=await real(entry.previewPath);if(!within(entry.directory,checked)||(await fs.stat(checked)).size>8*1024*1024)return null;
        const simple=path.extname(checked).toLowerCase()==='.webp'?null:await thumbnail(checked);if(simple)return simple;
        return poster({...entry,sourceKind:entry.kind,kind:'image',mediaPath:checked,previewOnly:true,capability:'supported'});
      }
      return entry.kind==='video'&&entry.capability==='supported'?poster(entry):null;
    },
    findSource(source){return [...entries.values()].find(e=>source.kind==='scene'?e.kind==='scene'&&path.resolve(e.directory).toLowerCase()===path.resolve(source.directory).toLowerCase():e.mediaPath&&path.resolve(e.mediaPath).toLowerCase()===path.resolve(source.file).toLowerCase())?.id||null}
  };
}
module.exports={createLibrary,discoverSteamRoots,safeFile,videoExtensions};
