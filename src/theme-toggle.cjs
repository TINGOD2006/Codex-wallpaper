const {detectLayout,contractChecks,structureExpression,SUPPORTED_VERSIONS,loginSelectors,desktopSelectors}=require('./adapters.cjs');
const TOGGLE_ID='miku-desktop-theme-toggle';
const OWNER='miku-desktop-theme';
class ThemeToggle {
  constructor(protocol,appVersion){this.protocol=protocol;this.appVersion=appVersion;}
  async request(){
    const value=await this.protocol.evaluate(`(() => {const b=document.getElementById('${TOGGLE_ID}');return b?.dataset.owner==='${OWNER}'?b.dataset.request:null;})()`);
    return ['on','off','live'].includes(value)?value:null;
  }
  async sync(status,{acknowledge=false}={}){
    return this.protocol.evaluate(`(() => {
      const status=${JSON.stringify(status)};
      const SUPPORTED_VERSIONS=${JSON.stringify(SUPPORTED_VERSIONS)},loginSelectors=${JSON.stringify(loginSelectors)},desktopSelectors=${JSON.stringify(desktopSelectors)};
      const contractChecks=${contractChecks.toString()};
      const supported=(${detectLayout.toString()})(${structureExpression},${JSON.stringify(this.appVersion)});
      let b=document.getElementById('${TOGGLE_ID}');
      if(b&&b.dataset.owner!=='${OWNER}')throw new Error('Theme toggle owner mismatch');
      if(b&&b.dataset.version!=='2'){b.remove();b=null;}
      if(!['codex','chatgpt'].includes(supported.kind)){b?.remove();return false;}
      if(!b){
        b=document.createElement('button');b.id='${TOGGLE_ID}';b.dataset.owner='${OWNER}';b.dataset.version='2';b.type='button';
        b.style.cssText='all:initial;position:fixed;top:6px;right:160px;height:30px;box-sizing:border-box;padding:0 12px;display:inline-flex;align-items:center;justify-content:center;border:1px solid #667985;border-radius:15px;background:#283946;color:#eff5f7;font:12px "Segoe UI",sans-serif;cursor:pointer;z-index:2147483000;-webkit-app-region:no-drag;user-select:none;';
        b.setAttribute('role','switch');
        b.addEventListener('click',event=>{
          event.preventDefault();event.stopPropagation();
          if(b.disabled)return;
          b.dataset.request=b.dataset.next||'on';
          b.disabled=true;b.textContent='切換中…';b.setAttribute('aria-busy','true');
        });
        b.addEventListener('focus',()=>{b.style.outline='2px solid #9bd9d5';b.style.outlineOffset='2px';});
        b.addEventListener('blur',()=>{b.style.outline='none';});
        document.body.append(b);
      }
      if(${JSON.stringify(acknowledge)})delete b.dataset.request;
      if(b.dataset.request)return true;
      const on=status.state==='applied';
      const live=on&&status.sceneSelected;
      const failed=live&&status.scene?.state==='error';
      b.dataset.next=failed?'live':!on?'on':status.sceneAvailable&&!live?'live':'off';
      b.disabled=false;b.setAttribute('aria-busy','false');b.setAttribute('aria-checked',String(on));
      b.title=b.dataset.next==='live'?'切換為即時場景':b.dataset.next==='off'?'切換為原版外觀':'切換為靜態初音';
      b.textContent=failed?'動態失敗 · 重試':!on?'外觀：原版':live?(status.scene?.state==='loading'?'動態載入中…':'外觀：動態'):'外觀：初音';
      b.setAttribute('aria-label',b.textContent+'，'+b.title);
      b.style.borderColor=on?'#7cb8b6':'#667985';
      return true;
    })()`);
  }
  async remove(){return this.protocol.evaluate(`(() => {const b=document.getElementById('${TOGGLE_ID}');if(b?.dataset.owner==='${OWNER}')b.remove();})()`);}
}
module.exports={ThemeToggle,TOGGLE_ID};
