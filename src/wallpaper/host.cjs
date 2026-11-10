const {structureExpression,detectLayout,contractChecks}=require('../adapters.cjs');
const {buildWallpaperStyles}=require('./styles.cjs');
const OWNER='codex-wallpaper';
function layoutError(layout){const failed=layout.requiredChecks.filter(c=>!c.passed);return Object.assign(new Error(layout.reason),{code:failed.length===1&&failed[0].id==='mode'?'HOST_SHELL_PENDING':'ADAPTER_LAYOUT_MISMATCH',stage:'probe',checks:layout.requiredChecks})}
class WallpaperHost {
  constructor(protocol,appVersion){this.client=protocol;this.appVersion=appVersion;}
  async inspect(){return this.client.evaluate(`(()=>{const s=${structureExpression};return {...s,documentToken:String(performance.timeOrigin)}})()`)}
  async viewport(){return this.client.evaluate(`(()=>{const frames=document.querySelectorAll('[data-app-shell-frame="true"]');if(frames.length!==1)return null;const box=frames[0].getBoundingClientRect();return {cssWidth:box.width,cssHeight:box.height,dpr:devicePixelRatio,visible:document.visibilityState!=='hidden'&&box.width>0&&box.height>0,documentToken:String(performance.timeOrigin)}})()`)}
  async synchronize(settings){
    // Both modes share the same shell selectors and styles. Validate the actual
    // mode and full contract in the same task as any repairs, without caching DOM.
    const styles=buildWallpaperStyles(settings,{kind:'codex'});
    const result=await this.client.evaluate(`(()=>{
      const structure={...${structureExpression},documentToken:String(performance.timeOrigin)};
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
      if(layer&&(!styles.background||layer.parentElement!==frame||layer.firstElementChild?.id!=='codex-wallpaper-image')){layer.remove();layer=null}
      const image=layer?.querySelector('#codex-wallpaper-image'),box=frame.getBoundingClientRect();
      return {structure,viewport:{cssWidth:box.width,cssHeight:box.height,dpr:devicePixelRatio,visible:document.visibilityState!=='hidden'&&box.width>0&&box.height>0,documentToken:structure.documentToken},
        imageMissing:!image,proof:{stylesConfirmed:true,imageConfirmed:!!(image&&image.complete&&image.naturalWidth>0&&image.currentSrc===image.getAttribute('src'))},
        metrics:image?.dataset.cwMetricsVersion==='1'?{documentToken:structure.documentToken,leaseId:image.dataset.cwLeaseId||null,loads:Number(image.dataset.cwLoads||0),at:performance.now(),outputSize:image.complete&&image.naturalWidth>0?{width:image.naturalWidth,height:image.naturalHeight}:null}:null};
    })()`);
    const layout=detectLayout(result.structure,this.appVersion);
    if(!layout.ok)throw layoutError(layout);
    this.documentToken=result.structure.documentToken;
    return result;
  }
  async apply(settings){
    const snapshot=await this.inspect(),layout=detectLayout(snapshot,this.appVersion);
    if(layout.kind==='unsupported'){const error=layoutError(layout);if(error.code!=='HOST_SHELL_PENDING')await this.restoreAll();throw error}
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
  async paint(uri,{leaseId=null}={}){
    if(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(uri)||uri.length>16*1024*1024)throw new Error('Invalid wallpaper frame');
    if(leaseId!==null&&(typeof leaseId!=='string'||leaseId.length>128||/[\x00-\x1f]/.test(leaseId)))throw new Error('Invalid renderer lease');
    return this.client.evaluate(`(()=>{
      if(!document.getElementById('codex-wallpaper-background'))return false;
      const frame=document.querySelector('[data-app-shell-frame="true"]');if(!frame)return false;
      let layer=document.getElementById('codex-wallpaper-layer');if(layer&&layer.dataset.owner!=='${OWNER}')throw new Error('Wallpaper layer owner mismatch');
      if(layer&&layer.parentElement!==frame){layer.remove();layer=null}
      if(!layer){layer=document.createElement('div');layer.id='codex-wallpaper-layer';layer.dataset.owner='${OWNER}';layer.setAttribute('aria-hidden','true');const image=document.createElement('img');image.id='codex-wallpaper-image';image.alt='';const scrim=document.createElement('div');scrim.id='codex-wallpaper-scrim';layer.append(image,scrim);frame.prepend(layer)}
      const image=layer.firstElementChild,uri=${JSON.stringify(uri)},leaseId=${JSON.stringify(leaseId||'')};
      if(image.dataset.cwMetricsVersion!=='1'){image.dataset.cwMetricsVersion='1';image.dataset.cwLoads='0';image.dataset.cwFrameId='0';image.addEventListener('load',()=>{if(!image.complete||!image.naturalWidth||image.currentSrc!==image.getAttribute('src'))return;image.dataset.cwDecoded='true';if(image.dataset.cwLastLoadedId!==image.dataset.cwFrameId){image.dataset.cwLastLoadedId=image.dataset.cwFrameId;image.dataset.cwLoads=String(Number(image.dataset.cwLoads||0)+1)}});image.addEventListener('error',()=>{image.dataset.cwDecoded='false'})}
      if(image.dataset.cwLeaseId!==leaseId){image.dataset.cwLeaseId=leaseId;image.dataset.cwLoads='0';image.dataset.cwLastLoadedId=''}
      if(image.getAttribute('src')!==uri){image.dataset.cwDecoded='false';image.dataset.cwFrameId=String(Number(image.dataset.cwFrameId||0)+1);image.src=uri}return true;
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
  async restoreAll(){return this.client.evaluate(`(()=>{for(const id of ['codex-wallpaper-layer','codex-wallpaper-background','codex-wallpaper-materials','codex-wallpaper-colors']){const node=document.getElementById(id);if(node&&node.dataset.owner!=='${OWNER}')throw new Error('Wallpaper owner mismatch');node?.remove()}})()`)}
}
module.exports={WallpaperHost};
