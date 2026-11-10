/* Only this owned UI is injected; all user supplied strings use textContent. */
function mountWallpaperPanel(options){
 'use strict';
 const {sessionId,panelId,binding,css,fullWindowMaterials}=options;
 const OWNER='codex-wallpaper',old=window.__codexWallpaperPanel;
 if(old?.owner===OWNER&&old.panelId===panelId&&document.getElementById('codex-wallpaper-button'))return true;
 old?.owner===OWNER&&old.dispose();
 for(const id of ['codex-wallpaper-panel','codex-wallpaper-button','codex-wallpaper-panel-style']){const node=document.getElementById(id);if(node&&node.dataset.owner!==OWNER)throw new Error('Wallpaper panel owner mismatch');node?.remove()}
 let seq=0,model=null,closed=false,open=false,patch={},needsSave=false,previewTimer,saveTimer,tab='library',cardsKey='',presetsKey='',limit=60;const pending=new Map(),controls=new Map(),thumbs=new Set();
 function el(tag,text,attrs={}){const node=document.createElement(tag);if(text!==null&&text!==undefined)node.textContent=text;for(const [k,v]of Object.entries(attrs))node.setAttribute(k,String(v));return node}
 function button(text,action,parent){const b=el('button',text,{type:'button'});b.addEventListener('click',action);parent?.append(b);return b}
 const style=el('style',css,{id:'codex-wallpaper-panel-style','data-owner':OWNER});document.head.append(style);
 const launcher=el('button','◈ Wallpaper',{id:'codex-wallpaper-button','data-owner':OWNER,type:'button','aria-label':'Wallpaper 桌布設定','aria-expanded':'false','aria-controls':'codex-wallpaper-panel'});
 const panel=el('aside',null,{id:'codex-wallpaper-panel','data-owner':OWNER,'aria-label':'Wallpaper 設定'});panel.hidden=true;
 const header=el('header'),title=el('div');title.append(el('strong','Wallpaper'),el('small','自訂背景，保留原版格局'));header.append(title);button('關閉',()=>show(false),header).setAttribute('aria-label','關閉 Wallpaper 設定');panel.append(header);
 const master=el('div',null,{class:'cw-master'});panel.append(master);
 const status=el('div','正在連接…',{class:'cw-status','aria-live':'polite'}),error=el('div','',{class:'cw-error',role:'alert'});panel.append(status,error);
 const tabs=el('nav',null,{role:'tablist','aria-label':'Wallpaper 分頁'}),body=el('div',null,{class:'cw-body'});panel.append(tabs,body);
 const sections={};for(const [key,name]of [['library','桌布庫'],['reading','畫面'],['materials','材質'],['playback','播放'],['presets','預設']]){
  const b=button(name,()=>activate(key),tabs);b.id='cw-tab-'+key;b.setAttribute('role','tab');b.setAttribute('aria-controls','cw-section-'+key);b.addEventListener('keydown',e=>{const keys=Object.keys(sections);if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const at=keys.indexOf(tab),next=e.key==='Home'?0:e.key==='End'?keys.length-1:(at+(e.key==='ArrowRight'?1:-1)+keys.length)%keys.length;activate(keys[next]);tabs.children[next].focus()}});
  const s=el('section',null,{id:'cw-section-'+key,role:'tabpanel','aria-labelledby':b.id});sections[key]=s;body.append(s);
 }
 function activate(key){flush();tab=key;for(const [k,s]of Object.entries(sections)){s.hidden=k!==key;const b=document.getElementById('cw-tab-'+k);b.setAttribute('aria-selected',String(k===key));b.tabIndex=k===key?0:-1}if(key==='library')renderCards(true)}
 function show(value){open=value;panel.hidden=!value;launcher.setAttribute('aria-expanded',String(value));if(value){activate(tab);document.getElementById('cw-tab-'+tab).focus()}else{flush();launcher.focus()}}
 launcher.addEventListener('click',()=>show(!open));
 panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();show(false)}});
 launcher.addEventListener('keydown',e=>{if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();show(false)}});
 function send(action,payload={}){
  if(closed)return Promise.resolve({ok:false});const n=++seq;
  const promise=new Promise(resolve=>{const timer=setTimeout(()=>{pending.delete(n);error.textContent='操作逾時，請重試。';resolve({ok:false})},310000);pending.set(n,{resolve,timer})});
  try{window[binding](JSON.stringify({sessionId,panelId,seq:n,action,payload}))}catch{error.textContent='設定連線已中斷';const p=pending.get(n);clearTimeout(p.timer);p.resolve({ok:false});pending.delete(n)}return promise;
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
 function field(parent,path,label,{type='range',min,max,step=.01,options}={}){
  const row=el('label',null,{class:'cw-field'}),text=el('span',label),output=el('output'),input=el(type==='select'?'select':'input',null,{'aria-label':label,'data-setting':path});row.append(text);
  if(type==='select'){for(const [value,name]of options)input.append(el('option',name,{value}))}else{input.type=type;if(min!==undefined)input.min=min;if(max!==undefined)input.max=max;input.step=step}
  const current=()=>type==='checkbox'?input.checked:['range','number'].includes(type)?Number(input.value):input.value;
  input.addEventListener(type==='range'?'input':'change',()=>{if(type==='range')paintRange(input);output.textContent=String(current());updatePath(path,current(),type==='range')});input.addEventListener('focusout',()=>{if(type==='range')flush()});
  if(type==='range')row.append(output);row.append(input);parent.append(row);controls.set(path,{input,output,type});return input;
 }
 function heading(parent,text){parent.append(el('h3',text))}
 field(master,'enabled','啟用客製化',{type:'checkbox'});field(master,'wallpaper.enabled','顯示桌布',{type:'checkbox'});
 const lib=sections.library,tools=el('div',null,{class:'cw-tools'});button('匯入圖片／影片',()=>send('library.import'),tools);button('加入資料夾',()=>send('library.addRoot'),tools);button('重新掃描',()=>send('library.refresh'),tools);lib.append(tools);
 const search=el('input',null,{type:'search',placeholder:'搜尋已安裝桌布','aria-label':'搜尋桌布'}),filter=el('select',null,{'aria-label':'桌布類型'});for(const [v,n]of [['all','全部類型'],['image','圖片'],['scene','Scene'],['video','影片'],['unsupported','未支援']])filter.append(el('option',n,{value:v}));
 const filters=el('div',null,{class:'cw-filters'}),favorite=el('input',null,{type:'checkbox','aria-label':'只看收藏'}),hidden=el('input',null,{type:'checkbox','aria-label':'顯示隱藏'});const fl=el('label','收藏 '),hl=el('label','顯示隱藏 ');fl.append(favorite);hl.append(hidden);filters.append(search,filter,fl,hl);lib.append(filters);
 const grid=el('div',null,{class:'cw-grid'});lib.append(grid);for(const input of [search,filter,favorite,hidden])input.addEventListener('input',()=>{limit=60;renderCards(true)});
 const observer=new IntersectionObserver(items=>{for(const item of items)if(item.isIntersecting){observer.unobserve(item.target);const id=item.target.dataset.id;if(!thumbs.has(id)){thumbs.add(id);send('library.thumbnail',{id}).then(reply=>{if(reply.ok&&/^data:image\/(jpeg|png|webp);base64,/.test(reply.thumbnail||'')){const img=item.target.querySelector('img');if(img)img.src=reply.thumbnail}})}}},{root:body,rootMargin:'100px'});
 function renderCards(force=false){
  if(!model)return;const key=JSON.stringify([model.cards,model.settings.playback.playlist,search.value,filter.value,favorite.checked,hidden.checked,limit]);if(!force&&key===cardsKey)return;cardsKey=key;observer.disconnect();thumbs.clear();grid.replaceChildren();
  const cards=(model.cards||[]).filter(c=>(hidden.checked||!c.hidden)&&(!favorite.checked||c.favorite)&&(filter.value==='all'||filter.value==='unsupported'&&c.capability!=='supported'||filter.value===c.kind)&&c.title.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()));
  if(!cards.length)grid.append(el('p','沒有符合的桌布。可匯入圖片、影片或加入 Wallpaper Engine 資料夾。',{class:'cw-muted'}));
  for(const c of cards.slice(0,limit)){
   const card=el('article',null,{class:'cw-card'+(c.selected?' cw-selected':''),'data-id':c.id}),pick=button('',()=>send('wallpaper.select',{id:c.id}),card);pick.className='cw-pick';pick.disabled=c.capability!=='supported';pick.setAttribute('aria-label','選擇 '+c.title);const img=el('img',null,{alt:'',loading:'lazy'}),placeholder=el('span',c.kind.toUpperCase(),{class:'cw-placeholder'});pick.append(placeholder,img,el('strong',c.title));
   card.append(el('small',c.capability==='supported'?`${c.kind} · ${c.contentRating==='unknown'?'分級未知':c.contentRating}`:c.reason||'此類型尚未支援',{class:'cw-muted'}));
   const actions=el('div',null,{class:'cw-card-actions'});button(c.favorite?'★ 已收藏':'☆ 收藏',()=>send('library.favorite',{id:c.id,value:!c.favorite}),actions);button(c.hidden?'取消隱藏':'隱藏',()=>send('library.hide',{id:c.id,value:!c.hidden}),actions);
   const playlist=model.settings.playback.playlist;const included=playlist.includes(c.id);if(c.capability==='supported')button(included?'✓ 輪播':'＋ 輪播',()=>send('settings.patch',{patch:{playback:{playlist:included?playlist.filter(id=>id!==c.id):[...playlist,c.id]}}}),actions);card.append(actions);grid.append(card);if(open&&tab==='library')observer.observe(card);
  }
  if(cards.length>limit)button(`顯示更多（${cards.length-limit}）`,()=>{limit+=60;renderCards(true)},grid);
 }
 const reading=sections.reading;heading(reading,'閱讀與取景');
 for(const [key,name,min,max,step]of [['scrim','閱讀遮罩',0,1,.01],['opacity','桌布透明度',0,1,.01],['brightness','亮度',.25,1.75,.01],['contrast','對比',.5,1.5,.01],['saturation','飽和度',0,2,.01],['blur','背景模糊',0,24,.5],['x','水平焦點',0,100,1],['y','垂直焦點',0,100,1],['offsetX','水平位移（px）',-2000,2000,1],['offsetY','垂直位移（px）',-2000,2000,1],['scale','縮放',.5,3,.01]])field(reading,'reading.'+key,name,{min,max,step});
 field(reading,'reading.fit','填滿方式',{type:'select',options:[['cover','填滿'],['contain','完整顯示'],['stretch','延展']]});field(reading,'reading.flip','水平翻轉',{type:'checkbox'});
 const maskRow=el('label','自訂遮罩顏色 '),maskOn=el('input',null,{type:'checkbox','aria-label':'自訂遮罩顏色'}),mask=el('input',null,{type:'color','aria-label':'遮罩顏色'});maskRow.append(maskOn,mask);reading.append(maskRow);maskOn.addEventListener('change',()=>updatePath('reading.maskColor',maskOn.checked?mask.value:null));mask.addEventListener('change',()=>{maskOn.checked=true;updatePath('reading.maskColor',mask.value)});button('重設畫面',()=>send('reset.section',{section:'reading'}),reading);
 const materials=sections.materials;
 button('套用全視窗材質',()=>send('settings.patch',{patch:{materials:fullWindowMaterials}}),materials).disabled=!fullWindowMaterials;
 materials.append(el('p','讓同一張背景延伸至頂欄、側欄、聊天、輸入框與各面板。預設不加模糊，優先保留播放效能。',{class:'cw-muted'}));
 for(const [region,name]of [['chat','聊天區'],['sidebar','左側欄'],['composer','輸入框'],['titlebar','頂欄'],['panels','右側／編輯面板'],['overlays','設定／浮層']]){heading(materials,name);field(materials,`materials.${region}.enabled`,'啟用'+name+'玻璃',{type:'checkbox'});field(materials,`materials.${region}.alpha`,name+'底色濃度',{min:0,max:1});field(materials,`materials.${region}.blur`,name+'玻璃模糊',{min:0,max:24,step:.5});field(materials,`materials.${region}.border`,name+'邊框強度',{min:0,max:.4})}
 heading(materials,'選用配色');materials.append(el('p','預設沿用 Codex 原生深／淺色。',{class:'cw-muted'}));field(materials,'colors.enabled','啟用自訂配色',{type:'checkbox'});for(const [key,name]of [['surface','主底色'],['panel','面板色'],['text','文字'],['muted','次要文字'],['accent','強調色'],['selection','選取底色']])field(materials,'colors.palette.'+key,name,{type:'color'});button('重設材質與配色',()=>send('reset.section',{section:'materials'}),materials);
 const playback=sections.playback;heading(playback,'播放與效能');field(playback,'performance.powerSaving','省電模式（靜態圖片）',{type:'checkbox'});playback.append(el('p','省電時顯示最後一幀或預覽圖並停止動態渲染；關閉後恢復原尺寸與完整效果。',{class:'cw-muted'}));field(playback,'performance.rendererMode','渲染方式',{type:'select',options:[['auto','自動（優先共用）'],['pool','共用渲染'],['isolated','獨立渲染']]});field(playback,'performance.resolutionMode','輸出尺寸',{type:'select',options:[['window','跟隨視窗'],['manual','手動尺寸']]});field(playback,'performance.cacheEnabled','使用貼圖快取',{type:'checkbox'});
 const sceneControls=el('div',null,{id:'cw-scene-controls',role:'group','aria-label':'場景即時渲染控制'});playback.append(sceneControls);heading(sceneControls,'場景即時渲染');
 field(sceneControls,'playback.sceneLive','場景即時渲染',{type:'checkbox'});
 const sceneFpsRow=el('div',null,{class:'cw-tools'}),sceneFpsButtons=[];
 sceneControls.append(sceneFpsRow);for(const fps of [15,30,60]){const b=button(fps+' FPS',()=>send('settings.patch',{patch:{playback:{renderFps:fps,displayFps:fps}}}),sceneFpsRow);b.setAttribute('aria-label','場景即時渲染 '+fps+' FPS');b.dataset.sceneFps=String(fps);sceneFpsButtons.push(b)}
 const sceneFpsCurrent=el('small','',{class:'cw-muted'});sceneFpsRow.append(sceneFpsCurrent);
 const sceneHint=el('p','關閉後顯示最後一幀或預覽圖，停止 WebGL 與畫面擷取。',{class:'cw-muted'});sceneControls.append(sceneHint);
 sceneControls.append(el('p','選擇幀數會同步引擎與背景更新頻率；畫質檔不另設 FPS 上限。高幀率需要較多資源。',{class:'cw-muted'}));
 const rendererStatus=el('p','等待渲染狀態',{class:'cw-muted','aria-live':'polite'}),cacheStatus=el('p','',{class:'cw-muted'}),cacheClear=button('清理貼圖快取',()=>send('renderer.cache.clear'),playback);playback.append(rendererStatus,cacheStatus);
 field(playback,'playback.paused','暫停播放',{type:'checkbox'});field(playback,'playback.muted','靜音',{type:'checkbox'});for(const [key,name,min,max,step]of [['volume','音量',0,1,.01],['renderFps','引擎 FPS',15,60,1],['displayFps','背景更新 FPS',1,60,1],['width','渲染寬度',320,1920,1],['height','渲染高度',240,1080,1]])field(playback,'playback.'+key,name,{min,max,step});
 field(playback,'playback.pauseWhenHidden','隱藏／最小化時暫停',{type:'checkbox'});heading(playback,'桌布輪播');field(playback,'playback.rotationEnabled','啟用輪播',{type:'checkbox'});field(playback,'playback.rotationSeconds','輪播間隔（秒）',{type:'number',min:30,max:86400,step:1});playback.append(el('p','在桌布庫用「＋ 輪播」選取項目；略過隱藏及未支援桌布。',{class:'cw-muted'}));button('重設播放',()=>send('reset.section',{section:'playback'}),playback);
 const preset=sections.presets;heading(preset,'預設方案');const presetSelect=el('select',null,{'aria-label':'選擇預設'}),presetName=el('input',null,{type:'text',maxlength:64,placeholder:'預設名稱','aria-label':'預設名稱'});preset.append(presetSelect,presetName);const pa=el('div',null,{class:'cw-tools'});preset.append(pa);
 button('套用',()=>send('presets.apply',{id:presetSelect.value}),pa);button('另存目前設定',()=>send('presets.save',{name:presetName.value}),pa);const rename=button('改名',()=>send('presets.rename',{id:presetSelect.value,name:presetName.value}),pa),remove=button('刪除',()=>send('presets.delete',{id:presetSelect.value}),pa);button('匯入 JSON',()=>send('presets.import'),pa);button('匯出 JSON',()=>send('presets.export',{id:presetSelect.value}),pa);
 function presetButtons(){const builtin=presetSelect.value.startsWith('builtin:');rename.disabled=builtin;remove.disabled=builtin}presetSelect.addEventListener('change',presetButtons);
 heading(preset,'還原');preset.append(el('p','還原原版會暫停全部客製化，保留桌布來源、收藏及使用者預設。',{class:'cw-muted'}));button('還原原版外觀',()=>send('reset.all'),preset);
 function update(state){
  if(closed||!state?.settings||(model&&state.revision<model.revision))return;model=state;
  for(const [path,{input,output,type}]of controls){if(document.activeElement===input)continue;const v=get(path);if(type==='checkbox')input.checked=v;else input.value=String(v);if(type==='range')paintRange(input);output.textContent=String(v)}
  if(document.activeElement!==mask){maskOn.checked=!!state.settings.reading.maskColor;mask.value=state.settings.reading.maskColor||'#181818'}
  const p=state.playback||{},rendering=state.rendering,powerSaving=state.settings.performance.powerSaving,names={off:'已停用',loading:'載入中',playing:'播放中',paused:'已暫停',static:powerSaving?'靜態畫面（省電模式）':'靜態畫面（即時渲染已關閉）',error:'播放錯誤'};status.textContent=(p.preview?(p.state==='error'?'動態載入失敗，已保留靜態背景':'靜態背景已顯示，正在預載動態場景'):(names[p.state]||'已連接'))+(p.state==='playing'&&Number.isFinite(rendering?.decodedFps)?` · 畫面 ${rendering.decodedFps} FPS`:'')+(state.dirty?' · 尚未儲存':' · 已儲存');error.textContent=state.error||'';
  const scene=(state.cards||[]).find(c=>c.id===state.settings.wallpaper.selectedId)?.kind==='scene';
  sceneControls.hidden=!scene;sceneFpsRow.hidden=state.settings.playback.sceneLive===false||powerSaving;controls.get('playback.sceneLive').input.disabled=powerSaving;
  sceneFpsCurrent.textContent='目前上限 '+state.settings.playback.renderFps+' FPS'+([15,30,60].includes(state.settings.playback.renderFps)?'':'（保留原設定）');
  for(const b of sceneFpsButtons)b.setAttribute('aria-pressed',String(Number(b.dataset.sceneFps)===state.settings.playback.renderFps));
  controls.get('playback.renderFps').input.closest('label').hidden=scene;
  sceneHint.textContent=p.state==='static'?({captured:'顯示關閉前的最後一幀；場景引擎已停止。',cache:'顯示已保存的靜態畫面；場景引擎已停止。',preview:'顯示桌布預覽圖；場景引擎已停止。',empty:'沒有快取或預覽圖，暫時顯示原生底色；可開啟一次即時渲染來保存畫面。'}[p.staticSource]||'場景引擎已停止，正在顯示靜態畫面。'):'關閉後顯示最後一幀或預覽圖，停止 WebGL 與畫面擷取。';
  for(const key of ['width','height']){const input=controls.get('playback.'+key).input;input.disabled=state.settings.performance?.resolutionMode==='window';input.title=input.disabled?'切換手動尺寸後可調整':''}
  controls.get('performance.rendererMode').input.disabled=rendering?.controlsAvailable!==true;controls.get('performance.cacheEnabled').input.disabled=rendering?.controlsAvailable!==true;cacheClear.disabled=rendering?.controlsAvailable!==true;
  const backend={pool:'共用渲染',isolated:'獨立渲染',image:'靜態圖片'},output=rendering?.outputSize,parts=[backend[rendering?.backend]||'等待渲染'];if(output)parts.push(`目前輸出 ${output.width} × ${output.height}`);if(rendering?.renderSize?.limited)parts.push('已達尺寸上限');for(const [key,label]of [['renderFps','引擎'],['captureFps','擷取'],['decodedFps','畫面']])if(Number.isFinite(rendering?.[key]))parts.push(`${label} ${rendering[key]} FPS`);if(rendering?.fallbackReason)parts.push('共用渲染暫不可用，已使用獨立渲染');if(rendering?.recovery?.blocked)parts.push('自動恢復已停止，請按重新連線重試');else if(rendering?.healthy===false)parts.push('渲染器失聯，正在確認');rendererStatus.textContent=parts.join(' · ');
  const cached=rendering?.cache,reasons={CACHE_DISABLED:'已關閉',CACHE_UNVERIFIED:'等待快取驗證',CACHE_VERIFYING:'正在驗證',CACHE_UNAVAILABLE:'快取暫不可用',CACHE_PRESSURE:'快取額度已滿',CACHE_NOT_APPLICABLE:'目前來源不使用貼圖快取',CACHE_RELOAD_REQUIRED:'下次載入時套用快取'};cacheStatus.textContent=cached?`${cached.effectiveCacheEnabled?'快取已啟用':reasons[cached.reason]||'快取未啟用'}${Number.isFinite(cached.usedBytes)&&Number.isFinite(cached.limitBytes)?` · ${(cached.usedBytes/1048576).toFixed(1)} / ${(cached.limitBytes/1048576).toFixed(0)} MiB`:''}${Number.isFinite(cached.readHits)?` · 儲存命中 ${cached.readHits} 次`:''}${Number.isFinite(rendering?.bake?.hits)?` · 本次載入命中 ${rendering.bake.hits}／未命中 ${rendering.bake.misses}`:''}`:'快取服務尚未連接';
  if(!state.error&&state.settings.wallpaper.selectedId?.startsWith('missing:'))error.textContent='先前的桌布來源已失效，請在桌布庫選擇替代資源。';
  launcher.dataset.enabled=String(state.settings.enabled);renderCards();const key=JSON.stringify(state.presets);if(key!==presetsKey){presetsKey=key;const chosen=presetSelect.value;presetSelect.replaceChildren();for(const p of state.presets||[])presetSelect.append(el('option',p.name+(p.missing?'（桌布遺失）':''),{value:p.id}));if([...presetSelect.options].some(o=>o.value===chosen))presetSelect.value=chosen;presetButtons()}
 }
 function receive(reply){if(closed||reply.sessionId!==sessionId||reply.panelId!==panelId)return;const request=pending.get(reply.seq);if(!request)return;clearTimeout(request.timer);pending.delete(reply.seq);if(reply.state)update(reply.state);if(!reply.ok)error.textContent=reply.error||'操作失敗';else if(reply.cancelled)status.textContent='已取消';request.resolve(reply)}
 function dispose(){closed=true;clearTimeout(previewTimer);clearTimeout(saveTimer);observer.disconnect();for(const p of pending.values()){clearTimeout(p.timer);p.resolve({ok:false})}pending.clear();panel.remove();launcher.remove();style.remove();if(window.__codexWallpaperPanel?.panelId===panelId)delete window.__codexWallpaperPanel}
 window.__codexWallpaperPanel={owner:OWNER,panelId,update,receive,dispose};document.body.append(launcher,panel);activate('library');return true;
}
if(typeof module!=='undefined')module.exports={mountWallpaperPanel};
