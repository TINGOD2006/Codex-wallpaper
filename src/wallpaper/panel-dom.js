/* Only this owned UI is injected; all user supplied strings use textContent. */
function mountWallpaperPanel(options){
 'use strict';
 const {sessionId,panelId,binding,css,fullWindowMaterials}=options;
 const OWNER='codex-wallpaper',old=window.__codexWallpaperPanel;
 if(old?.owner===OWNER&&old.panelId===panelId&&document.getElementById('codex-wallpaper-button'))return true;
 old?.owner===OWNER&&old.dispose();
 for(const id of ['codex-wallpaper-panel','codex-wallpaper-button','codex-wallpaper-panel-style']){const node=document.getElementById(id);if(node&&node.dataset.owner!==OWNER)throw new Error('Wallpaper panel owner mismatch');node?.remove()}
 let seq=0,model=null,hostState=null,closed=false,open=false,patch={},needsSave=false,previewTimer,saveTimer,tab='library',cardsKey='',presetsKey='',limit=60;
 const pending=new Map(),controls=new Map(),scrollPositions=new Map();
 function el(tag,text,attrs={}){const node=document.createElement(tag);if(text!==null&&text!==undefined)node.textContent=text;for(const [k,v]of Object.entries(attrs))node.setAttribute(k,String(v));return node}
 function button(text,action,parent){const b=el('button',text,{type:'button'});b.addEventListener('click',action);parent?.append(b);return b}
 const style=el('style',css,{id:'codex-wallpaper-panel-style','data-owner':OWNER});document.head.append(style);
 const launcher=el('button','◈ Wallpaper',{id:'codex-wallpaper-button','data-owner':OWNER,type:'button','aria-label':'Wallpaper 桌布設定','aria-expanded':'false','aria-controls':'codex-wallpaper-panel'});
 const panel=el('aside',null,{id:'codex-wallpaper-panel','data-owner':OWNER,'aria-label':'Wallpaper 設定'});panel.hidden=true;
 const header=el('header');header.append(el('strong','Wallpaper'));
 button('關閉',()=>show(false),header).setAttribute('aria-label','關閉 Wallpaper 設定');panel.append(header);
 const nowPlaying=el('div',null,{class:'cw-now','aria-label':'目前桌布'}),nowPreview=createThumbnail('桌布');
 const nowInfo=el('div',null,{class:'cw-now-info'}),nowTitle=el('strong','尚未選擇桌布');
 const status=el('div','正在連接…',{class:'cw-status',role:'status'});
 nowInfo.append(nowTitle,status);nowPlaying.append(nowPreview,nowInfo);
 const quickActions=el('div',null,{class:'cw-quick-actions'});
 const pause=button('暫停',()=>runQuick(pause,'playback.pause',{paused:!model.settings.playback.paused}),quickActions);
 const next=button('下一張',()=>{const id=nextInPlaylist(model);if(id)runQuick(next,'wallpaper.select',{id})},quickActions);
 pause.disabled=next.disabled=true;nowPlaying.append(quickActions);panel.append(nowPlaying);
 const master=el('div',null,{class:'cw-master'}),error=el('div','',{class:'cw-error',role:'alert'});panel.append(master,error);
 const tabs=el('nav',null,{role:'tablist','aria-label':'Wallpaper 分頁'}),body=el('div',null,{class:'cw-body'});panel.append(tabs,body);
 const sections={};for(const [key,name]of [['library','桌布庫'],['reading','畫面'],['materials','材質'],['playback','播放'],['presets','預設']]){
  const b=button(name,()=>activate(key),tabs);b.id='cw-tab-'+key;b.setAttribute('role','tab');b.setAttribute('aria-controls','cw-section-'+key);b.addEventListener('keydown',e=>{const keys=Object.keys(sections);if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const at=keys.indexOf(tab),next=e.key==='Home'?0:e.key==='End'?keys.length-1:(at+(e.key==='ArrowRight'?1:-1)+keys.length)%keys.length;activate(keys[next]);tabs.children[next].focus()}});
  const s=el('section',null,{id:'cw-section-'+key,role:'tabpanel','aria-labelledby':b.id});sections[key]=s;body.append(s);
 }
 function activate(key){
  flush();
  const changed=tab!==key;
  if(changed)scrollPositions.set(tab,body.scrollTop);
  tab=key;
  for(const [k,s]of Object.entries(sections)){s.hidden=k!==key;const b=document.getElementById('cw-tab-'+k);b.setAttribute('aria-selected',String(k===key));b.tabIndex=k===key?0:-1}
  if(key==='library')renderCards();
  if(changed)body.scrollTop=scrollPositions.get(key)||0;
  pumpThumbnails();
 }
 function show(value){
  open=value;panel.hidden=!value;launcher.setAttribute('aria-expanded',String(value));
  if(value){activate(tab);document.getElementById('cw-tab-'+tab).focus()}
  else{flush();launcher.focus()}
 }
 launcher.addEventListener('click',()=>show(!open));
 panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();show(false)}});
 launcher.addEventListener('keydown',e=>{if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();show(false)}});
 function send(action,payload={}){
  if(closed)return Promise.resolve({ok:false});const n=++seq;
  const quiet=action==='library.thumbnail';
  const promise=new Promise(resolve=>{const timer=setTimeout(()=>{pending.delete(n);if(!quiet)error.textContent='操作逾時，請重試。';resolve({ok:false})},310000);pending.set(n,{resolve,timer,quiet})});
  try{window[binding](JSON.stringify({sessionId,panelId,seq:n,action,payload}))}catch{if(!quiet)error.textContent='設定連線已中斷';const p=pending.get(n);clearTimeout(p.timer);p.resolve({ok:false});pending.delete(n)}return promise;
 }
 function merge(a,b){for(const [k,v]of Object.entries(b)){if(v&&typeof v==='object'&&!Array.isArray(v)){a[k]??={};merge(a[k],v)}else a[k]=v}return a}
 function updatePath(path,value,preview){const bits=path.split('.'),p={};let at=p;bits.forEach((k,i)=>{if(i===bits.length-1)at[k]=value;else at=at[k]={}});if(!preview){send('settings.patch',{patch:p});return}merge(patch,p);needsSave=true;clearTimeout(previewTimer);previewTimer=setTimeout(()=>{const next=patch;patch={};send('settings.patch',{patch:next,persist:false})},80);clearTimeout(saveTimer);saveTimer=setTimeout(flush,400)}
 function flush(){clearTimeout(previewTimer);clearTimeout(saveTimer);if(!model)return;const next=patch;patch={};if(needsSave||Object.keys(next).length||model.dirty){needsSave=false;send('settings.patch',{patch:next,persist:true})}}
 function get(path){return path.split('.').reduce((a,k)=>a?.[k],model?.settings)}
 function paintRange(input){
  const min=Number(input.min||0),max=Number(input.max||100),value=Number(input.value);
  const progress=max>min?Math.max(0,Math.min(100,(value-min)*100/(max-min))):0;
  input.style.setProperty('--cw-range-progress',progress+'%');
 }
 const percent=value=>Math.round(value*100)+'%';
 const pixels=value=>value+' px';
 function field(parent,path,label,{type='range',min,max,step=.01,options,format=String}={}){
  const row=el('label',null,{class:'cw-field'}),text=el('span',label),output=el('output'),input=el(type==='select'?'select':'input',null,{'aria-label':label,'data-setting':path});row.append(text);
  if(type==='select'){for(const [value,name]of options)input.append(el('option',name,{value}))}else{input.type=type;if(min!==undefined)input.min=min;if(max!==undefined)input.max=max;input.step=step}
  const current=()=>type==='checkbox'?input.checked:['range','number'].includes(type)?Number(input.value):input.value;
  input.addEventListener(type==='range'?'input':'change',()=>{
   const value=current();
   if(type==='range'){paintRange(input);output.textContent=format(value)}
   updatePath(path,value,type==='range');
  });
  if(type==='range'){input.addEventListener('focusout',flush);row.append(output)}
  row.append(input);parent.append(row);controls.set(path,{input,output,type,format});return input;
 }
 function heading(parent,text){parent.append(el('h3',text))}
 function disclosure(parent,label){
  const details=el('details',null,{class:'cw-disclosure'}),summary=el('summary',label),content=el('div',null,{class:'cw-disclosure-body'});
  details.append(summary,content);parent.append(details);return {summary,content};
 }
 field(master,'enabled','啟用客製化',{type:'checkbox'});field(master,'wallpaper.enabled','顯示桌布',{type:'checkbox'});
 const lib=sections.library,filters=el('div',null,{class:'cw-filters'});
 const search=el('input',null,{type:'search',placeholder:'搜尋桌布標題', 'aria-label':'搜尋桌布'});
 const filter=el('select',null,{'aria-label':'桌布類型'}),rating=el('select',null,{'aria-label':'內容分級'});
 for(const [value,name]of [['all','全部類型'],['image','圖片'],['scene','場景'],['video','影片'],['unsupported','未支援']])filter.append(el('option',name,{value}));
 const ratingNames={everyone:'全年齡',questionable:'需斟酌',mature:'成人',unknown:'未標記'};
 const ratingKey=card=>card.contentRating?.trim().toLowerCase()||'unknown';
 let ratingsKey='';
 function renderRatings(cards){
  const ratings=new Map();
  for(const card of cards){const key=ratingKey(card);if(!ratings.has(key))ratings.set(key,Object.hasOwn(ratingNames,key)?ratingNames[key]:card.contentRating)}
  const ordered=[...ratings].sort(([a],[b])=>a.localeCompare(b));
  const key=JSON.stringify(ordered);
  if(key===ratingsKey)return;
  ratingsKey=key;
  const previous=rating.value;
  rating.replaceChildren(el('option','全部分級',{value:''}),...ordered.map(([value,name])=>el('option',name,{value})));
  rating.value=ratings.has(previous)?previous:'';
 }
 const favoritesOnly=el('input',null,{type:'checkbox','aria-label':'只看收藏'}),showHidden=el('input',null,{type:'checkbox','aria-label':'顯示隱藏'});
 const favoriteLabel=el('label',null),hiddenLabel=el('label',null);
 favoriteLabel.append(favoritesOnly,'只看收藏');hiddenLabel.append(showHidden,'顯示隱藏');
 filters.append(search,filter,rating,favoriteLabel,hiddenLabel);lib.append(filters);
 const libraryBar=el('div',null,{class:'cw-library-bar'}),resultCount=el('span','',{class:'cw-muted'});
 const viewModes=el('div',null,{class:'cw-segments',role:'group','aria-label':'桌布庫檢視'});
 const viewKey='codex-wallpaper.library-view';
 let libraryView='cards';try{if(localStorage.getItem(viewKey)==='list')libraryView='list'}catch{}
 const grid=el('div',null,{class:'cw-grid','data-view':libraryView});
 for(const [value,label]of [['cards','卡片'],['list','清單']]){
  const toggle=button(label,()=>{
   libraryView=value;grid.dataset.view=value;
   for(const other of viewModes.children)other.setAttribute('aria-pressed',String(other.dataset.view===value));
   try{localStorage.setItem(viewKey,value)}catch{}
  },viewModes);
  toggle.dataset.view=value;toggle.setAttribute('aria-pressed',String(libraryView===value));
 }
 const sourceMenu=disclosure(lib,'管理來源');
 const tools=el('div',null,{class:'cw-tools'});sourceMenu.content.append(tools);
 button('匯入圖片／影片',()=>send('library.import'),tools);button('加入資料夾',()=>send('library.addRoot'),tools);
 const scan=button('重新掃描',async()=>{
  const result=await runQuick(scan,'library.refresh');
  if(result?.ok){
   thumbnailVersion++;thumbnailCache.clear();previewBytes=0;applyThumbnail(nowPreview,null);
   renderCards(true);pumpThumbnails();
  }
 },tools);
 libraryBar.append(resultCount,viewModes);lib.append(libraryBar,grid);
 for(const input of [search,filter,rating,favoritesOnly,showHidden])input.addEventListener('input',()=>{limit=60;body.scrollTop=0;renderCards()});

 const kindNames={image:'圖片',scene:'場景',video:'影片',web:'網頁',application:'應用程式'};
 const kindName=card=>kindNames[card.kind]||card.kind;
 const thumbnailCache=new Map(),visiblePreviews=new Set(),thumbnailJobs=new Set();
 const maxPreviewBytes=8*1024*1024;
 let previewBytes=0,thumbnailVersion=0;
 function createThumbnail(label){
  const preview=el('span',null,{class:'cw-thumbnail','aria-hidden':'true'});
  preview.append(el('span',label,{class:'cw-placeholder'}),el('img',null,{alt:'',decoding:'async'}));
  return preview;
 }
 function useThumbnail(preview,id,label){
  if((preview.dataset.previewId||null)!==id){
   preview.lastElementChild.removeAttribute('src');
   if(id)preview.dataset.previewId=id;else delete preview.dataset.previewId;
  }
  if(preview.firstElementChild.textContent!==label)preview.firstElementChild.textContent=label;
 }
 function storeThumbnail(id,uri){
  thumbnailCache.set(id,uri);previewBytes+=uri?.length||0;
  while(thumbnailCache.size>160||previewBytes>maxPreviewBytes){
   const first=thumbnailCache.keys().next().value;
   previewBytes-=thumbnailCache.get(first)?.length||0;thumbnailCache.delete(first);
  }
 }
 function applyThumbnail(preview,uri){
  const img=preview.lastElementChild;
  if(uri){if(img.getAttribute('src')!==uri)img.src=uri}
  else img.removeAttribute('src');
 }
 function loadThumbnail(preview){
  const id=preview.dataset.previewId;
  if(!id||preview.lastElementChild.hasAttribute('src'))return;
  if(thumbnailCache.has(id)){applyThumbnail(preview,thumbnailCache.get(id));return}
  if(thumbnailJobs.has(id)||thumbnailJobs.size>=2)return;
  const version=thumbnailVersion;thumbnailJobs.add(id);
  send('library.thumbnail',{id}).then(reply=>{
   if(closed||version!==thumbnailVersion)return;
   const uri=reply.ok&&typeof reply.thumbnail==='string'&&reply.thumbnail.length<=3*1024*1024&&/^data:image\/(jpeg|png|webp);base64,/.test(reply.thumbnail)?reply.thumbnail:null;
   storeThumbnail(id,uri);
  }).finally(()=>{thumbnailJobs.delete(id);pumpThumbnails()});
 }
 function pumpThumbnails(){
  if(closed||!open||document.hidden)return;
  loadThumbnail(nowPreview);
  if(tab==='library')for(const preview of visiblePreviews)loadThumbnail(preview);
 }
 const observer=new IntersectionObserver(items=>{
  for(const item of items){
   if(item.isIntersecting&&grid.contains(item.target))visiblePreviews.add(item.target);
   else visiblePreviews.delete(item.target);
  }
  pumpThumbnails();
 },{root:body,rootMargin:'72px'});
 let playlistUpdate=Promise.resolve();
 function togglePlaylist(id){
  playlistUpdate=playlistUpdate.then(()=>{
   const ids=model.settings.playback.playlist;
   return send('settings.patch',{patch:{playback:{playlist:ids.includes(id)?ids.filter(entry=>entry!==id):[...ids,id]}}});
  });
 }
 function playablePlaylist(state){
  const ids=new Set(state.settings.playback.playlist);
  if(!ids.size)return [];
  const playable=new Set((state.cards||[]).filter(c=>ids.has(c.id)&&!c.hidden&&c.capability==='supported').map(c=>c.id));
  return [...ids].filter(id=>playable.has(id));
 }
 function nextInPlaylist(state,ids=state?playablePlaylist(state):[]){
  if(!ids.length)return null;
  const current=state.settings.wallpaper.selectedId;
  const id=ids[(ids.indexOf(current)+1)%ids.length];
  return id&&id!==current?id:null;
 }
 async function runQuick(control,action,payload){
  if(control.disabled||!model)return;
  control.dataset.busy='true';control.disabled=true;
  try{return await send(action,payload)}
  finally{delete control.dataset.busy;control.disabled=false;renderNow()}
 }
 function renderCards(force=false){
  if(!model||tab!=='library')return;
  const cards=model.cards||[];
  renderRatings(cards);
  const query=search.value.trim().toLocaleLowerCase(),playlist=model.settings.playback.playlist;
  const key=JSON.stringify([cards,playlist,query,filter.value,rating.value,favoritesOnly.checked,showHidden.checked,limit]);
  if(!force&&key===cardsKey)return;
  cardsKey=key;
  const focus=grid.contains(document.activeElement)?document.activeElement:null;
  const focusId=focus?.closest('.cw-card')?.dataset.id;
  const focusAction=focus?.dataset.cardAction;
  observer.disconnect();visiblePreviews.clear();
  const matches=cards.filter(c=>(showHidden.checked||!c.hidden)&&(!favoritesOnly.checked||c.favorite)&&(!rating.value||ratingKey(c)===rating.value)&&
   (filter.value==='all'||filter.value==='unsupported'&&c.capability!=='supported'||filter.value===c.kind)&&c.title.toLocaleLowerCase().includes(query));
  resultCount.textContent=`${matches.length} 張桌布`;
  const fragment=document.createDocumentFragment(),previews=[],included=new Set(playlist);
  let restoreFocus=null;
  for(const c of matches.slice(0,limit)){
   const card=el('article',null,{class:'cw-card'+(c.selected?' cw-selected':''),'data-id':c.id});
   const pick=button(null,()=>send('wallpaper.select',{id:c.id}),card);
   pick.className='cw-pick';pick.disabled=c.capability!=='supported';pick.title=c.title;
   pick.setAttribute('aria-label','選擇 '+c.title);pick.dataset.cardAction='select';
   if(c.selected)pick.setAttribute('aria-current','true');
   const preview=createThumbnail(kindName(c));
   useThumbnail(preview,c.id,kindName(c));previews.push(preview);
   const caption=el('span',null,{class:'cw-card-caption'});
   const contentRating=ratingKey(c),ratingLabel=Object.hasOwn(ratingNames,contentRating)?ratingNames[contentRating]:c.contentRating;
   const meta=c.capability==='supported'?[kindName(c),c.selected?'已選取':'',c.hidden?'已隱藏':'',ratingLabel].filter(Boolean).join(' · '):c.reason||'此類型尚未支援';
   caption.append(el('strong',c.title),el('small',meta,{class:'cw-muted',title:meta}));pick.append(preview,caption);
   const actions=el('div',null,{class:'cw-card-actions'});card.append(actions);
   const addAction=(action,label,symbol,pressed,run)=>{
    const control=button(symbol,run,actions);control.dataset.cardAction=action;
    control.title=label;control.setAttribute('aria-label',label+' '+c.title);
    if(pressed!==null)control.setAttribute('aria-pressed',String(pressed));
   };
   addAction('favorite',c.favorite?'取消收藏':'收藏',c.favorite?'★':'☆',c.favorite,()=>send('library.favorite',{id:c.id,value:!c.favorite}));
   if(c.capability==='supported')addAction('playlist',included.has(c.id)?'從輪播移除':'加入輪播',included.has(c.id)?'✓':'＋',included.has(c.id),()=>togglePlaylist(c.id));
   addAction('hide',c.hidden?'取消隱藏':'隱藏',c.hidden?'顯示':'隱藏',null,()=>send('library.hide',{id:c.id,value:!c.hidden}));
   if(c.id===focusId)restoreFocus=Array.from(card.querySelectorAll('[data-card-action]')).find(node=>node.dataset.cardAction===focusAction);
   fragment.append(card);
  }
  if(!matches.length)fragment.append(el('p',cards.length?'沒有符合篩選條件的桌布。':'請匯入圖片、影片或加入 Wallpaper Engine 資料夾。',{class:'cw-empty cw-muted'}));
  if(matches.length>limit)button(`顯示更多（${matches.length-limit}）`,()=>{limit+=60;renderCards()},fragment).className='cw-more';
  grid.replaceChildren(fragment);
  for(const preview of previews)observer.observe(preview);
  if(focus)(restoreFocus||search).focus({preventScroll:true});
 }
 const reading=sections.reading;
 heading(reading,'取景');
 field(reading,'reading.fit','填滿方式',{type:'select',options:[['cover','填滿'],['contain','完整顯示'],['stretch','延展']]});field(reading,'reading.flip','水平翻轉',{type:'checkbox'});
 field(reading,'reading.scale','縮放',{min:.5,max:3,format:percent});
 for(const [key,label]of [['x','水平焦點'],['y','垂直焦點']])field(reading,'reading.'+key,label,{min:0,max:100,step:1,format:value=>value+'%'});
 const offset=disclosure(reading,'精確位移');
 for(const [key,label]of [['offsetX','水平位移'],['offsetY','垂直位移']])field(offset.content,'reading.'+key,label,{min:-2000,max:2000,step:1,format:pixels});
 heading(reading,'閱讀與色調');
 for(const [key,name,min,max]of [['scrim','閱讀遮罩',0,1],['opacity','桌布透明度',0,1],['brightness','亮度',.25,1.75],['contrast','對比',.5,1.5],['saturation','飽和度',0,2]])field(reading,'reading.'+key,name,{min,max,format:percent});
 field(reading,'reading.blur','背景模糊',{min:0,max:24,step:.5,format:pixels});
 const maskRow=el('div',null,{class:'cw-field'}),maskLabel=el('label','自訂遮罩顏色'),maskOn=el('input',null,{type:'checkbox','aria-label':'自訂遮罩顏色'}),mask=el('input',null,{type:'color','aria-label':'遮罩顏色'});
 maskLabel.append(maskOn);maskRow.append(maskLabel,mask);reading.append(maskRow);
 maskOn.addEventListener('change',()=>updatePath('reading.maskColor',maskOn.checked?mask.value:null));mask.addEventListener('change',()=>{maskOn.checked=true;updatePath('reading.maskColor',mask.value)});
 button('重設畫面',()=>send('reset.section',{section:'reading'}),reading);
 const materials=sections.materials;
 const materialBar=el('div',null,{class:'cw-tools'});materials.append(materialBar);
 const fullWindow=button('套用全視窗材質',()=>send('settings.patch',{patch:{materials:fullWindowMaterials}}),materialBar);
 fullWindow.className='cw-primary';fullWindow.disabled=!fullWindowMaterials;
 button('重設材質與配色',()=>send('reset.section',{section:'materials'}),materialBar);
 const materialStates=new Map();
 for(const [region,name]of [['chat','聊天區'],['sidebar','左側欄'],['composer','輸入框'],['titlebar','頂欄'],['panels','右側／編輯面板'],['overlays','設定／浮層']]){
  const {summary,content}=disclosure(materials,name),badge=el('small','原生',{class:'cw-disclosure-status'});
  summary.append(badge);materialStates.set(region,badge);
  field(content,`materials.${region}.enabled`,'啟用'+name+'玻璃',{type:'checkbox'});
  field(content,`materials.${region}.alpha`,name+'底色濃度',{min:0,max:1,format:percent});
  field(content,`materials.${region}.blur`,name+'玻璃模糊',{min:0,max:24,step:.5,format:pixels});
  field(content,`materials.${region}.border`,name+'邊框強度',{min:0,max:.4,format:percent});
 }
 const colors=disclosure(materials,'自訂配色').content;
 field(colors,'colors.enabled','啟用自訂配色',{type:'checkbox'});
 for(const [key,name]of [['surface','主底色'],['panel','面板色'],['text','文字'],['muted','次要文字'],['accent','強調色'],['selection','選取底色']])field(colors,'colors.palette.'+key,name,{type:'color'});
 const playback=sections.playback;
 heading(playback,'播放控制');
 field(playback,'performance.powerSaving','省電模式（靜態圖片）',{type:'checkbox'});
 field(playback,'playback.paused','暫停播放',{type:'checkbox'});
 const sceneControls=el('div',null,{id:'cw-scene-controls',class:'cw-control-group',role:'group','aria-label':'場景即時渲染控制'});playback.append(sceneControls);
 field(sceneControls,'playback.sceneLive','場景即時渲染',{type:'checkbox'});
 const sceneFpsRow=el('div',null,{class:'cw-frame-rate'}),sceneFpsButtons=[];
 const sceneFpsGroup=el('div',null,{class:'cw-segments',role:'group','aria-label':'場景幀率'});
 sceneControls.append(sceneFpsRow);sceneFpsRow.append(sceneFpsGroup);
 for(const fps of [15,30,60]){const b=button(fps+' FPS',()=>send('settings.patch',{patch:{playback:{renderFps:fps,displayFps:fps}}}),sceneFpsGroup);b.setAttribute('aria-label','場景即時渲染 '+fps+' FPS');b.dataset.sceneFps=String(fps);sceneFpsButtons.push(b)}
 const sceneFpsCurrent=el('small','',{class:'cw-muted'});sceneFpsRow.append(sceneFpsCurrent);
 const sceneHint=el('p','關閉後顯示最後一幀或預覽圖，停止 WebGL 與畫面擷取。',{class:'cw-muted'});sceneControls.append(sceneHint);
 const sound=disclosure(playback,'聲音').content;
 field(sound,'playback.muted','靜音',{type:'checkbox'});field(sound,'playback.volume','音量',{min:0,max:1,format:percent});
 const rotation=disclosure(playback,'桌布輪播'),rotationCount=el('small','',{class:'cw-disclosure-status'});
 rotation.summary.append(rotationCount);
 field(rotation.content,'playback.rotationEnabled','啟用輪播',{type:'checkbox'});field(rotation.content,'playback.rotationSeconds','輪播間隔（秒）',{type:'number',min:30,max:86400,step:1});
 rotation.content.append(el('p','在桌布庫按「＋」加入輪播。自動輪播需要至少兩張可播放的桌布。',{class:'cw-muted'}));
 const advanced=disclosure(playback,'進階播放設定').content;
 field(advanced,'playback.pauseWhenHidden','隱藏／最小化時暫停',{type:'checkbox'});
 field(advanced,'performance.rendererMode','渲染方式',{type:'select',options:[['auto','自動（優先共用）'],['pool','共用渲染'],['isolated','獨立渲染']]});
 field(advanced,'performance.resolutionMode','輸出尺寸',{type:'select',options:[['window','跟隨視窗'],['manual','手動尺寸']]});
 for(const [key,name,min,max,format]of [['renderFps','引擎 FPS',15,60,String],['displayFps','背景更新 FPS',1,60,String],['width','渲染寬度',320,1920,pixels],['height','渲染高度',240,1080,pixels]])field(advanced,'playback.'+key,name,{min,max,step:1,format});
 field(advanced,'performance.cacheEnabled','使用貼圖快取',{type:'checkbox'});
 const rendererStatus=el('p','等待渲染狀態',{class:'cw-muted'}),cacheStatus=el('p','',{class:'cw-muted'}),cacheClear=button('清理貼圖快取',()=>send('renderer.cache.clear'),advanced);advanced.append(rendererStatus,cacheStatus);
 button('重設播放',()=>send('reset.section',{section:'playback'}),advanced);
 const preset=sections.presets;heading(preset,'預設方案');const presetSelect=el('select',null,{'aria-label':'選擇預設'}),presetName=el('input',null,{type:'text',maxlength:64,placeholder:'預設名稱','aria-label':'預設名稱'});preset.append(presetSelect,presetName);const pa=el('div',null,{class:'cw-tools'});preset.append(pa);
 button('套用',()=>send('presets.apply',{id:presetSelect.value}),pa);button('另存目前設定',()=>send('presets.save',{name:presetName.value}),pa);const rename=button('改名',()=>send('presets.rename',{id:presetSelect.value,name:presetName.value}),pa),remove=button('刪除',()=>send('presets.delete',{id:presetSelect.value}),pa);button('匯入 JSON',()=>send('presets.import'),pa);button('匯出 JSON',()=>send('presets.export',{id:presetSelect.value}),pa);
 function presetButtons(){const builtin=presetSelect.value.startsWith('builtin:');rename.disabled=builtin;remove.disabled=builtin}presetSelect.addEventListener('change',presetButtons);
 heading(preset,'還原');preset.append(el('p','還原原版會暫停全部客製化，保留桌布來源、收藏及使用者預設。',{class:'cw-muted'}));button('還原原版外觀',()=>send('reset.all'),preset);
 function renderNow(){
  if(!model)return;
  const settings=model.settings,p=model.playback||{},selectedId=settings.wallpaper.selectedId;
  const current=(model.cards||[]).find(card=>card.id===(selectedId||p.pendingId));
  const title=current?.title||(selectedId?'找不到已選桌布':'尚未選擇桌布');
  if(nowTitle.textContent!==title){nowTitle.textContent=title;nowTitle.title=title}
  useThumbnail(nowPreview,current?.id||null,current?kindName(current):'桌布');
  const enabled=settings.enabled&&settings.wallpaper.enabled,paused=settings.playback.paused;
  const playable=playablePlaylist(model);
  const playbackNames={off:'等待套用',loading:'載入中',playing:current?.kind==='image'?'顯示中':'播放中',paused:'已暫停',static:settings.performance.powerSaving?'靜態 · 省電':'靜態畫面',error:'播放錯誤'};
  let message;
  if(!enabled)message='已關閉';
  else if(hostState?.phase==='offline')message='服務離線';
  else if(p.state==='error'||hostState?.phase==='error'||hostState?.phase==='incompatible'||hostState?.error?.code==='RENDERER_FAILED')message=p.preview?'已保留靜態背景':'播放錯誤';
  else if(hostState?.observed?.suspended||p.suspended)message='已暫停';
  else if(hostState&&hostState.observed?.applied!==true)message=hostState.phase==='needs-launch'?'等待接入':'等待套用';
  else if(p.preview)message='靜態預覽 · 正在預載';
  else if(!current)message=selectedId?'來源遺失':'從桌布庫選擇';
  else if(paused)message='已暫停';
  else message=playbackNames[p.state]||'等待套用';
  const detail=[current?kindName(current):'',message,model.dirty?'尚未儲存':''].filter(Boolean).join(' · ');
  if(status.textContent!==detail)status.textContent=detail;
  pause.textContent=paused?'繼續':'暫停';
  pause.setAttribute('aria-label',paused?'繼續播放':'暫停播放');
  const offline=hostState?.phase==='offline';
  pause.disabled=!!pause.dataset.busy||!enabled||current?.capability!=='supported'||offline;
  const upcoming=nextInPlaylist(model,playable);
  next.disabled=!!next.dataset.busy||!enabled||!upcoming||offline;
  next.title=upcoming?'播放輪播中的下一張':'在桌布庫加入可播放的輪播項目';
  rotationCount.textContent=`${playable.length} 張`;
  pumpThumbnails();
 }
 function update(state){
  if(closed||!state?.settings||(model&&state.revision<model.revision))return;model=state;
  for(const [path,{input,output,type,format}]of controls){if(document.activeElement===input)continue;const v=get(path);if(type==='checkbox')input.checked=v;else input.value=String(v);if(type==='range'){paintRange(input);output.textContent=format(v)}}
  if(document.activeElement!==mask){maskOn.checked=!!state.settings.reading.maskColor;mask.value=state.settings.reading.maskColor||'#181818'}
  const p=state.playback||{},rendering=state.rendering,powerSaving=state.settings.performance.powerSaving;
  const issue=state.error||(state.settings.wallpaper.selectedId?.startsWith('missing:')?'先前的桌布來源已失效，請在桌布庫選擇替代資源。':'');
  if(error.textContent!==issue)error.textContent=issue;
  for(const [region,badge]of materialStates){
   const enabled=state.settings.materials[region].enabled;
   badge.dataset.enabled=String(enabled);badge.textContent=enabled?'已啟用':'原生';
  }
  const scene=(state.cards||[]).find(c=>c.id===state.settings.wallpaper.selectedId)?.kind==='scene';
  sceneControls.hidden=!scene;sceneFpsRow.hidden=state.settings.playback.sceneLive===false||powerSaving;controls.get('playback.sceneLive').input.disabled=powerSaving;
  const {renderFps,displayFps}=state.settings.playback,linked=renderFps===displayFps&&[15,30,60].includes(renderFps);
  sceneFpsCurrent.textContent=linked?'':`自訂上限 ${renderFps}／${displayFps} FPS`;
  sceneFpsCurrent.hidden=linked;
  for(const b of sceneFpsButtons)b.setAttribute('aria-pressed',String(linked&&Number(b.dataset.sceneFps)===renderFps));
  controls.get('playback.renderFps').input.closest('label').hidden=scene;
  sceneHint.textContent=p.state==='static'?({captured:'顯示最後一幀',cache:'顯示已儲存的靜態畫面',preview:'顯示桌布預覽圖',empty:'沒有可用的靜態圖片，顯示原生底色'}[p.staticSource]||'顯示靜態畫面'):powerSaving?'省電模式已關閉即時渲染':'';
  sceneHint.hidden=!sceneHint.textContent;
  for(const key of ['width','height']){const input=controls.get('playback.'+key).input;input.disabled=state.settings.performance?.resolutionMode==='window';input.title=input.disabled?'切換手動尺寸後可調整':''}
  controls.get('performance.rendererMode').input.disabled=rendering?.controlsAvailable!==true;controls.get('performance.cacheEnabled').input.disabled=rendering?.controlsAvailable!==true;cacheClear.disabled=rendering?.controlsAvailable!==true;
  const backend={pool:'共用渲染',isolated:'獨立渲染',image:'靜態圖片'},output=rendering?.outputSize,parts=[backend[rendering?.backend]||'等待渲染'];if(output)parts.push(`目前輸出 ${output.width} × ${output.height}`);if(rendering?.renderSize?.limited)parts.push('已達尺寸上限');for(const [key,label]of [['renderFps','引擎'],['captureFps','擷取'],['decodedFps','畫面']])if(Number.isFinite(rendering?.[key]))parts.push(`${label} ${rendering[key]} FPS`);if(rendering?.fallbackReason)parts.push('共用渲染暫不可用，已使用獨立渲染');if(rendering?.recovery?.blocked)parts.push('自動恢復已停止，請按重新連線重試');else if(rendering?.healthy===false)parts.push('渲染器失聯，正在確認');rendererStatus.textContent=parts.join(' · ');
  const cached=rendering?.cache,reasons={CACHE_DISABLED:'已關閉',CACHE_UNVERIFIED:'等待快取驗證',CACHE_VERIFYING:'正在驗證',CACHE_UNAVAILABLE:'快取暫不可用',CACHE_PRESSURE:'快取額度已滿',CACHE_NOT_APPLICABLE:'目前來源不使用貼圖快取',CACHE_RELOAD_REQUIRED:'下次載入時套用快取'};cacheStatus.textContent=cached?`${cached.effectiveCacheEnabled?'快取已啟用':reasons[cached.reason]||'快取未啟用'}${Number.isFinite(cached.usedBytes)&&Number.isFinite(cached.limitBytes)?` · ${(cached.usedBytes/1048576).toFixed(1)} / ${(cached.limitBytes/1048576).toFixed(0)} MiB`:''}${Number.isFinite(cached.readHits)?` · 儲存命中 ${cached.readHits} 次`:''}${Number.isFinite(rendering?.bake?.hits)?` · 本次載入命中 ${rendering.bake.hits}／未命中 ${rendering.bake.misses}`:''}`:'快取服務尚未連接';
  launcher.dataset.enabled=String(state.settings.enabled);renderNow();renderCards();const key=JSON.stringify(state.presets);if(key!==presetsKey){presetsKey=key;const chosen=presetSelect.value;presetSelect.replaceChildren();for(const p of state.presets||[])presetSelect.append(el('option',p.name+(p.missing?'（桌布遺失）':''),{value:p.id}));if([...presetSelect.options].some(o=>o.value===chosen))presetSelect.value=chosen;presetButtons()}
 }
 function receive(reply){if(closed||reply.sessionId!==sessionId||reply.panelId!==panelId)return;const request=pending.get(reply.seq);if(!request)return;clearTimeout(request.timer);pending.delete(reply.seq);if(!request.quiet){if(reply.state)update(reply.state);if(!reply.ok)error.textContent=reply.error||'操作失敗';else if(reply.cancelled)status.textContent='已取消'}request.resolve(reply)}
 document.addEventListener('visibilitychange',pumpThumbnails);
 function dispose(){closed=true;clearTimeout(previewTimer);clearTimeout(saveTimer);observer.disconnect();document.removeEventListener('visibilitychange',pumpThumbnails);visiblePreviews.clear();thumbnailCache.clear();thumbnailJobs.clear();for(const p of pending.values()){clearTimeout(p.timer);p.resolve({ok:false})}pending.clear();panel.remove();launcher.remove();style.remove();if(window.__codexWallpaperPanel?.panelId===panelId)delete window.__codexWallpaperPanel}
 window.__codexWallpaperPanel={owner:OWNER,panelId,update,receive,dispose,setHostState(state){hostState=state;renderNow()}};
 document.body.append(launcher,panel);activate('library');return true;
}
if(typeof module!=='undefined')module.exports={mountWallpaperPanel};
