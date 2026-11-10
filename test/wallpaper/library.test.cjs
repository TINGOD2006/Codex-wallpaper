const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createLibrary}=require('../../src/wallpaper/library.cjs');
const {defaults}=require('../../src/wallpaper/schema.cjs');
const {createThumbnailer}=require('../../src/wallpaper/thumbnails.cjs');

test('cards preserve favorite/title ordering and reflect edits and rescans without leaking mutable state',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'wallpaper-order-')),library=createLibrary({roots:[root],dataRoot:path.join(root,'data')});
 try{
  for(const [id,title] of [['1','Zulu'],['2','Alpha'],['3','Alpha']]){await fs.mkdir(path.join(root,id));await fs.writeFile(path.join(root,id,'project.json'),JSON.stringify({type:'scene',title}));await fs.writeFile(path.join(root,id,'scene.pkg'),'fixture')}
  const entries=await library.scan(),s=defaults(),z=entries.find(e=>e.title==='Zulu').id,a=entries.find(e=>e.title==='Alpha').id;
  const check=()=>{const cards=library.cards(s),expected=entries.map(e=>({id:e.id,title:e.title,favorite:s.library.favorites.includes(e.id)})).sort((a,b)=>Number(b.favorite)-Number(a.favorite)||a.title.localeCompare(b.title));assert.deepEqual(cards.map(e=>e.id),expected.map(e=>e.id));return cards};
  check();s.library.favorites.push(z,a);s.library.hidden.push(z);s.wallpaper.selectedId=a;
  let cards=check();assert.equal(cards.find(e=>e.id===z).hidden,true);assert.equal(cards.find(e=>e.id===a).selected,true);
  cards[0].title='mutated';cards.pop();assert.notEqual(check()[0].title,'mutated');
  s.library.favorites.length=0;check();
  await fs.writeFile(path.join(root,'1/project.json'),JSON.stringify({type:'scene',title:'Aardvark'}));await library.scan();assert.equal(library.cards(s).find(e=>e.id===z).title,'Aardvark');assert.deepEqual(library.cards(s).map(e=>e.title),library.cards(s).map(e=>e.title).sort((a,b)=>a.localeCompare(b)));
 }finally{await library.close()}
});
test('library keeps stable ids, survives malformed projects and exposes only safe public cards',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'wallpaper-library-'));
  for(const [id,p]of [['123',{type:'scene',file:'scene.json',title:'Scene <b>test</b>'}],['124',{type:'web',file:'index.html',title:'Web'}],['125',{type:'application',file:'run.exe',title:'App'}],['126',{type:'video',file:'../secret.mp4',title:'Escaped'}]]){
    const dir=path.join(root,id);await fs.mkdir(dir);await fs.writeFile(path.join(dir,'project.json'),JSON.stringify(p));if(id==='123')await fs.writeFile(path.join(dir,'scene.pkg'),'fixture');
  }
  await fs.mkdir(path.join(root,'127'));await fs.writeFile(path.join(root,'127/project.json'),'broken');
  const library=createLibrary({roots:[root,root+path.sep],dataRoot:path.join(root,'data')});await library.scan();const cards=library.cards(defaults());
  const scene=cards.find(c=>c.title.startsWith('Scene'));assert.ok(scene);assert.equal(cards.filter(c=>c.id===scene.id).length,1);assert.equal(scene.contentRating,'unknown');
  assert.equal(cards.find(c=>c.title==='Web').capability,'unsupported');assert.equal(cards.find(c=>c.title==='App').capability,'unsupported');assert.equal(cards.find(c=>c.title==='Escaped').capability,'unsupported');
  assert.equal(JSON.stringify(cards).includes(root),false);await library.scan();assert.equal(library.get(scene.id).title,'Scene <b>test</b>');
  const s=defaults();s.library.favorites=[scene.id];s.library.hidden=[scene.id];assert.equal(library.cards(s).find(c=>c.id===scene.id).favorite,true);assert.equal(library.cards(s).find(c=>c.id===scene.id).hidden,true);
});
test('import rejects disguised executables and leaves their source unchanged',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'wallpaper-import-')),file=path.join(root,'image.png');await fs.writeFile(file,'MZ-not-an-image');
  const library=createLibrary({roots:[],dataRoot:path.join(root,'data')});await assert.rejects(()=>library.importFile(file));assert.equal(await fs.readFile(file,'utf8'),'MZ-not-an-image');
});
test('library refuses a project directory linked outside its registered root',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'wallpaper-fence-')),outside=await fs.mkdtemp(path.join(os.tmpdir(),'wallpaper-outside-'));
  await fs.writeFile(path.join(outside,'project.json'),JSON.stringify({type:'scene',file:'scene.pkg',title:'Outside'}));await fs.writeFile(path.join(outside,'scene.pkg'),'fixture');
  await fs.symlink(outside,path.join(root,'linked'),'junction');const library=createLibrary({roots:[root],dataRoot:path.join(root,'data')});await library.scan();assert.equal(library.cards(defaults()).some(e=>e.title==='Outside'),false);
});
test('thumbnail conversion is deduplicated and limited to two concurrent jobs',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'wallpaper-thumbs-'));let active=0,peak=0,converted=0;
  const thumbnail=createThumbnailer({dataRoot:root,convert:async(file,out)=>{converted++;active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,25));await fs.writeFile(out,Buffer.from([255,216,255,217]));active--}});
  const files=await Promise.all([0,1,2,3].map(async n=>{const p=path.join(root,n+'.png');await fs.writeFile(p,'fixture');return p}));
  await Promise.all([thumbnail(files[0]),thumbnail(files[0]),...files.slice(1).map(thumbnail)]);assert.equal(converted,4);assert.equal(peak,2);
});
test('oversized project metadata is skipped without hiding valid neighbors',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'wallpaper-oversize-'));for(const name of ['good','huge']){const d=path.join(root,name);await fs.mkdir(d);await fs.writeFile(path.join(d,'scene.pkg'),'fixture');await fs.writeFile(path.join(d,'project.json'),JSON.stringify({type:'scene',title:name,padding:name==='huge'?'x'.repeat(2*1024*1024):''}))}
 const l=createLibrary({roots:[root],dataRoot:path.join(root,'data')});await l.scan();assert.ok(l.cards(defaults()).some(c=>c.title==='good'));assert.ok(!l.cards(defaults()).some(c=>c.title==='huge'));assert.ok(l.diagnostics().some(d=>d.code==='METADATA_TOO_LARGE'));await l.close();
});
test('closing poster service cancels active jobs and never starts queued renderers',async()=>{
 const {createPosterCache}=require('../../src/wallpaper/thumbnails.cjs'),root=await fs.mkdtemp(path.join(os.tmpdir(),'wallpaper-posters-close-'));let started=0,ended=0;
 const poster=createPosterCache({dataRoot:root,renderPoster:async(entry,{signal})=>{started++;try{await new Promise((resolve,reject)=>{if(signal.aborted)reject(new Error('cancelled'));else signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true})})}finally{ended++}}});
 assert.equal(typeof poster.close,'function');const entries=await Promise.all([1,2,3,4].map(async n=>{const mediaPath=path.join(root,n+'.webm');await fs.writeFile(mediaPath,'fixture');return {mediaPath}})),jobs=entries.map(poster);
 while(started<2)await new Promise(setImmediate);await poster.close();assert.equal(started,2);assert.equal(ended,2);assert.deepEqual(await Promise.all(jobs),[null,null,null,null]);assert.equal(await poster(entries[0]),null);
});
