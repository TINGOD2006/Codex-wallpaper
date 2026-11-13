const {structureExpression,desktopContractExpression,detectLayout,contractChecks}=require('../adapters.cjs');
const {buildWallpaperStyles}=require('./styles.cjs');
const OWNER='codex-wallpaper';
function layoutError(layout){const failed=layout.requiredChecks.filter(c=>!c.passed);return Object.assign(new Error(layout.reason),{code:failed.length===1&&failed[0].id==='mode'?'HOST_SHELL_PENDING':'ADAPTER_LAYOUT_MISMATCH',stage:'probe',checks:layout.requiredChecks})}
function canShowFallback(snapshot){
  return !!snapshot?.documentToken&&snapshot.rootViewportCount===0&&snapshot.frameCount===1&&snapshot.activeMainSurfaceCount===1;
}
// These functions also run in the verified host document.
function getOwned(id){
  const nodes=document.querySelectorAll('#'+id);
  if(nodes.length>1||nodes[0]&&nodes[0].dataset.owner!=='codex-wallpaper')throw new Error('Wallpaper owner mismatch');
  return nodes[0];
}
function setStyle(id,text){
  let node=getOwned(id);
  if(!text){node?.remove();return}
  if(!node){node=document.createElement('style');node.id=id;node.dataset.owner='codex-wallpaper';document.head.append(node)}
  if(node.textContent!==text)node.textContent=text;
}
function bindFrameMetrics(image){
  if(image.dataset.cwMetricsVersion==='1')return;
  image.dataset.cwMetricsVersion='1';image.dataset.cwLoads='0';image.dataset.cwFrameId='0';
  image.addEventListener('load',()=>{
    if(!image.complete||!image.naturalWidth||image.currentSrc!==image.getAttribute('src'))return;
    image.dataset.cwDecoded='true';
    if(image.dataset.cwLastLoadedId===image.dataset.cwFrameId)return;
    image.dataset.cwLastLoadedId=image.dataset.cwFrameId;
    image.dataset.cwLoads=String(Number(image.dataset.cwLoads||0)+1);
  });
  image.addEventListener('error',()=>{image.dataset.cwDecoded='false'});
}
const dataImage=/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
function checkFrame(uri,leaseId){
  if(typeof uri!=='string'||uri.length>16*1024*1024||!dataImage.test(uri))throw new Error('Invalid wallpaper frame');
  if(leaseId!==null&&(typeof leaseId!=='string'||leaseId.length>128||/[\x00-\x1f]/.test(leaseId)))throw new Error('Invalid renderer lease');
}
// The steady-state receiver only changes src on the mounted image. Setup, ownership checks
// that need an exact count, and decoded handoffs go through the existing paint transaction.
function paintMountedFrame(uri,leaseId){
  const frames=document.querySelectorAll('[data-app-shell-frame="true"]');
  if(frames.length!==1||document.querySelectorAll('#codex-wallpaper-background').length!==1)return null;
  const layer=document.getElementById('codex-wallpaper-layer');
  const image=layer?.firstElementChild;
  if(layer?.parentElement!==frames[0]||layer.dataset.owner!=='codex-wallpaper'||
    layer.dataset.cwFallback==='true'||image?.id!=='codex-wallpaper-image'||image.dataset.cwMetricsVersion!=='1'||
    document.getElementById('codex-wallpaper-background')?.dataset.owner!=='codex-wallpaper')return null;
  updateFrame(image,uri,leaseId);
  return true;
}
function updateFrame(image,uri,leaseId){
  if(image.dataset.cwLeaseId!==leaseId){image.dataset.cwLeaseId=leaseId;image.dataset.cwLoads='0';image.dataset.cwLastLoadedId=''}
  if(image.getAttribute('src')===uri)return;
  image.dataset.cwDecoded='false';
  image.dataset.cwFrameId=String(Number(image.dataset.cwFrameId||0)+1);
  image.src=uri;
}
const mountedPaintExpression=`(()=>{const updateFrame=${updateFrame.toString()};return (${paintMountedFrame.toString()})(`;
const paintTransactions=`const getOwned=${getOwned.toString()},setStyle=${setStyle.toString()},canShowFallback=${canShowFallback.toString()},bindFrameMetrics=${bindFrameMetrics.toString()},updateFrame=${updateFrame.toString()};`;
class WallpaperHost {
  constructor(protocol,appVersion){this.client=protocol;this.appVersion=appVersion;}
  supportsDecodedPaint=true;
  async inspect(){return this.client.evaluate(`(()=>{const s=${structureExpression};return {...s,documentToken:String(performance.timeOrigin)}})()`)}
  async viewport(){return this.client.evaluate(`(()=>{const frames=document.querySelectorAll('[data-app-shell-frame="true"]');if(frames.length!==1)return null;const box=frames[0].getBoundingClientRect();return {cssWidth:box.width,cssHeight:box.height,dpr:devicePixelRatio,visible:document.visibilityState!=='hidden'&&box.width>0&&box.height>0,documentToken:String(performance.timeOrigin)}})()`)}
  async synchronize(settings,{includeDiagnostics=true}={}){
    // Both modes share the same shell selectors and styles. Validate the actual
    // mode and full contract in the same task as any repairs, without caching DOM.
    const styles=buildWallpaperStyles(settings,{kind:'codex'});
    const result=await this.client.evaluate(`(()=>{
      const structure={...${includeDiagnostics?structureExpression:desktopContractExpression},documentToken:String(performance.timeOrigin)};
      if(!(${contractChecks.toString()})(structure).every(check=>check.passed))return {structure};
      const styles=${JSON.stringify(styles)},frame=document.querySelector('[data-app-shell-frame="true"]');
      const nodes=Object.entries(styles).map(([name,text])=>{
        const id='codex-wallpaper-'+name,matches=document.querySelectorAll('#'+id);
        if(matches.length>1||matches[0]&&matches[0].dataset.owner!=='${OWNER}')throw new Error('Wallpaper style owner mismatch');
        return {id,text,node:matches[0]};
      });
      const layers=document.querySelectorAll('#codex-wallpaper-layer');
      if(layers.length>1||layers[0]&&layers[0].dataset.owner!=='${OWNER}')throw new Error('Wallpaper layer owner mismatch');
      let layer=layers[0];
      for(let {id,text,node} of nodes){
        if(!text){node?.remove();continue}
        if(!node){node=document.createElement('style');node.id=id;node.dataset.owner='${OWNER}';document.head.append(node)}
        if(node.textContent!==text)node.textContent=text;
      }
      if(layer&&(!styles.background||layer.firstElementChild?.id!=='codex-wallpaper-image')){layer.remove();layer=null}
      if(layer&&layer.parentElement!==frame)frame.prepend(layer);
      const image=layer?.querySelector('#codex-wallpaper-image'),box=frame.getBoundingClientRect();
      const decoded=!!(image&&image.complete&&image.naturalWidth>0&&image.currentSrc===image.getAttribute('src'));
      const imageFailed=!!(image&&image.complete&&!decoded);
      return {structure,viewport:{cssWidth:box.width,cssHeight:box.height,dpr:devicePixelRatio,visible:document.visibilityState!=='hidden'&&box.width>0&&box.height>0,documentToken:structure.documentToken},
        imageMissing:!image||imageFailed,proof:{stylesConfirmed:true,imageConfirmed:decoded},
        metrics:image?.dataset.cwMetricsVersion==='1'?{documentToken:structure.documentToken,leaseId:image.dataset.cwLeaseId||null,loads:Number(image.dataset.cwLoads||0),at:performance.now(),outputSize:image.complete&&image.naturalWidth>0?{width:image.naturalWidth,height:image.naturalHeight}:null}:null};
    })()`);
    const layout=detectLayout(result.structure,this.appVersion);
    if(!layout.ok)throw layoutError(layout);
    this.documentToken=result.structure.documentToken;
    return result;
  }
  async apply(settings){
    const snapshot=await this.inspect(),layout=detectLayout(snapshot,this.appVersion);
    if(layout.kind==='unsupported'){
      const error=layoutError(layout);
      if(error.code!=='HOST_SHELL_PENDING'&&!canShowFallback(snapshot))await this.restoreAll();
      throw error;
    }
    const styles=buildWallpaperStyles(settings,layout),guard={documentToken:snapshot.documentToken,mode:layout.kind};
    const applied=await this.client.evaluate(`(()=>{
      const guard=${JSON.stringify(guard)};
      const current=${structureExpression};
      if(String(performance.timeOrigin)!==guard.documentToken||current.mode!==guard.mode||!(${contractChecks.toString()})(current).every(check=>check.passed))return false;
      const styles=${JSON.stringify(styles)};
      for(const name of ['background','materials','colors']){
        const id='codex-wallpaper-'+name;const matches=document.querySelectorAll('#'+id);if(matches.length>1)throw new Error('Ambiguous wallpaper styles');let node=matches[0];
        if(node&&node.dataset.owner!=='${OWNER}')throw new Error('Wallpaper style owner mismatch');
        if(!styles[name]){node?.remove();continue}if(!node){node=document.createElement('style');node.id=id;node.dataset.owner='${OWNER}';document.head.append(node)}if(node.textContent!==styles[name])node.textContent=styles[name];
      }
      if(!styles.background){const layer=document.getElementById('codex-wallpaper-layer');if(layer?.dataset.owner==='${OWNER}')layer.remove()}
      return true;
    })()`);
    if(!applied)throw Object.assign(new Error('Document changed while applying wallpaper'),{code:'LAYOUT_CHANGED'});
    this.documentToken=guard.documentToken;return {layout:layout.kind};
  }
  async validateImage(uri){
    if(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(uri)||uri.length>16*1024*1024)throw new Error('Invalid wallpaper frame');
    const valid=await this.client.evaluate(`new Promise(resolve=>{const i=new Image();const timer=setTimeout(()=>resolve(false),8000);i.onload=()=>{clearTimeout(timer);resolve(i.naturalWidth>0)};i.onerror=()=>{clearTimeout(timer);resolve(false)};i.src=${JSON.stringify(uri)}})`);if(!valid)throw new Error('Wallpaper image could not be decoded');
  }
  async showFallback(settings,uri,documentToken,{clearMaterials=false,existingOnly=false}={}){
    if(!settings.enabled||!settings.wallpaper.enabled||!documentToken)return false;
    const {validFrame}=require('./scene-still.cjs');
    if(!validFrame(uri))return false;
    const styles=buildWallpaperStyles(settings,{kind:'codex'});
    return this.#paint(uri,{documentToken,background:styles.background,clearMaterials,existingOnly});
  }
  async paint(uri,{leaseId=null,decoded=false}={}){
    checkFrame(uri,leaseId);
    if(!decoded){
      const painted=await this.client.evaluate(`${mountedPaintExpression}${JSON.stringify(uri)},${JSON.stringify(leaseId||'')})})()`);
      if(painted===true)return true;
    }
    return this.#paint(uri,{leaseId,decoded});
  }
  async #paint(uri,{leaseId=null,decoded=false,documentToken=null,background=null,clearMaterials=false,existingOnly=false}){
    return this.client.evaluate(`(async()=>{
      ${paintTransactions}
      const {uri,leaseId,decoded,documentToken,background,clearMaterials,existingOnly}=${JSON.stringify({uri,leaseId:leaseId||'',decoded,documentToken:documentToken||(decoded?this.documentToken:null),background,clearMaterials,existingOnly})};
      const applyFallbackStyles=background!==null;
      const getFrame=()=>{
        if(documentToken&&String(performance.timeOrigin)!==documentToken)return null;
        const frames=document.querySelectorAll('[data-app-shell-frame="true"]');
        if(frames.length!==1)return null;
        if(applyFallbackStyles){
          const visible=e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0&&e.checkVisibility();
          const count=selector=>Array.from(document.querySelectorAll(selector)).filter(visible).length;
          if(!canShowFallback({documentToken,
            rootViewportCount:count('#root > .zoom-adjusted-viewport:not(.pointer-events-none)'),frameCount:visible(frames[0])?1:0,
            activeMainSurfaceCount:count('[data-app-shell-active-page="true"] main[data-app-shell-main-surface="default"]')}))return null;
        }else if(!getOwned('codex-wallpaper-background'))return null;
        return frames[0];
      };
      const frame=getFrame();if(!frame)return false;
      const layerId='codex-wallpaper-layer';
      let layer=decoded||applyFallbackStyles?getOwned(layerId):document.getElementById(layerId),image=layer?.firstElementChild;
      if(layer&&layer.dataset.owner!=='${OWNER}')throw new Error('Wallpaper layer owner mismatch');
      if(image&&image.id!=='codex-wallpaper-image')throw new Error('Invalid wallpaper layer');
      const previous=image,previousSrc=image?.getAttribute('src');
      const alreadyDecoded=!!(image?.complete&&image.naturalWidth&&image.currentSrc===uri&&previousSrc===uri);
      if(existingOnly&&!alreadyDecoded)return false;
      if((decoded||applyFallbackStyles)&&!alreadyDecoded){
        // Decode off-screen so the last confirmed frame stays visible, including on failure.
        image=new Image();image.src=uri;let timer;
        try{await Promise.race([image.decode(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('decode timeout')),4000)})])}
        catch{return false}finally{clearTimeout(timer)}
        if(!image.naturalWidth||getFrame()!==frame||getOwned('codex-wallpaper-layer')!==layer||
          layer?.firstElementChild!==previous||previous?.getAttribute('src')!==previousSrc)return false;
      }
      if(applyFallbackStyles){
        const otherStyles=clearMaterials?['materials','colors'].map(name=>getOwned('codex-wallpaper-'+name)):[];
        setStyle('codex-wallpaper-background',background);otherStyles.forEach(node=>node?.remove());
      }
      if(!layer){
        layer=document.createElement('div');layer.id='codex-wallpaper-layer';layer.dataset.owner='${OWNER}';layer.setAttribute('aria-hidden','true');
        const scrim=document.createElement('div');scrim.id='codex-wallpaper-scrim';layer.append(scrim);
      }
      if(image!==previous||!image){image??=document.createElement('img');image.id='codex-wallpaper-image';image.alt=''}
      bindFrameMetrics(image);
      updateFrame(image,uri,leaseId);
      if(image!==previous){
        if(image.complete&&image.naturalWidth){image.dataset.cwDecoded='true';image.dataset.cwFrameId='1';image.dataset.cwLastLoadedId='1';image.dataset.cwLoads='1'}
        if(previous)previous.replaceWith(image);else layer.prepend(image);
      }
      if(applyFallbackStyles)layer.dataset.cwFallback='true';else if(decoded)delete layer.dataset.cwFallback;
      if(layer.parentElement!==frame)frame.prepend(layer);
      return true;
    })()`);
  }
  async confirmApplied(settings){
    const snapshot=await this.inspect(),layout=detectLayout(snapshot,this.appVersion);if(!layout.ok)throw layoutError(layout);
    const styles=buildWallpaperStyles(settings,layout);
    return this.client.evaluate(`(()=>{const styles=${JSON.stringify(styles)},stylesConfirmed=Object.entries(styles).every(([name,text])=>{const n=document.getElementById('codex-wallpaper-'+name);return text?n?.dataset.owner==='${OWNER}'&&n.textContent===text:!n});const layer=document.getElementById('codex-wallpaper-layer'),i=document.getElementById('codex-wallpaper-image');return {stylesConfirmed,imageConfirmed:!!(layer?.dataset.owner==='${OWNER}'&&i&&i.complete&&i.naturalWidth>0&&i.currentSrc===i.getAttribute('src'))}})()`);
  }
  async confirmImage(expectedUri){return this.client.evaluate(`(async()=>{const token=${JSON.stringify(this.documentToken)},layer=document.getElementById('codex-wallpaper-layer'),image=document.getElementById('codex-wallpaper-image'),expected=${JSON.stringify(expectedUri)};if(String(performance.timeOrigin)!==token||layer?.dataset.owner!=='${OWNER}'||image?.getAttribute('src')!==expected)return false;let timer;try{await Promise.race([image.decode(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('decode timeout')),8000)})])}catch{return false}finally{clearTimeout(timer)}return String(performance.timeOrigin)===token&&image.getAttribute('src')===expected&&image.complete&&image.naturalWidth>0})()`)}
  async imageMetrics(){return this.client.evaluate(`(()=>{const layer=document.getElementById('codex-wallpaper-layer'),image=document.getElementById('codex-wallpaper-image');if(layer?.dataset.owner!=='${OWNER}'||image?.dataset.cwMetricsVersion!=='1')return null;return {documentToken:String(performance.timeOrigin),leaseId:image.dataset.cwLeaseId||null,loads:Number(image.dataset.cwLoads||0),at:performance.now(),outputSize:image.complete&&image.naturalWidth>0?{width:image.naturalWidth,height:image.naturalHeight}:null}})()`)}
  async clearBackground(){return this.client.evaluate(`(()=>{const layer=document.getElementById('codex-wallpaper-layer');if(layer?.dataset.owner==='${OWNER}')layer.remove()})()`)}
  async restoreAll({fallbackToken}={}){
    return this.client.evaluate(`(()=>{
      const getOwned=${getOwned.toString()},token=${JSON.stringify(fallbackToken||null)};
      if(token&&(String(performance.timeOrigin)!==token||getOwned('codex-wallpaper-layer')?.dataset.cwFallback!=='true'))return;
      const nodes=['codex-wallpaper-layer','codex-wallpaper-background','codex-wallpaper-materials','codex-wallpaper-colors'].map(getOwned);
      nodes.forEach(node=>node?.remove());
    })()`);
  }
}
module.exports={WallpaperHost,canShowFallback};
