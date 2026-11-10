const {structureExpression}=require('./adapters.cjs');
const STYLE_ID='miku-desktop-theme-v1';
const OWNER='miku-desktop-theme';
class StyleHost {
  constructor(protocol){this.protocol=protocol;}
  async inspect() {
    return this.protocol.evaluate(`(() => {const result=${structureExpression};const s=document.getElementById('${STYLE_ID}');return {...result,documentToken:String(performance.timeOrigin),themeStylePresent:!!s&&s.dataset.owner==='${OWNER}'};})()`);
  }
  async validateImage(dataUri) {
    const loaded=await this.protocol.evaluate(`new Promise(resolve=>{const i=new Image();const timer=setTimeout(()=>resolve(false),8000);i.onload=()=>{clearTimeout(timer);resolve(i.naturalWidth>0&&i.naturalHeight>0)};i.onerror=()=>{clearTimeout(timer);resolve(false)};i.src=${JSON.stringify(dataUri)};})`);
    if(!loaded)throw new Error('The application could not decode or load the background image');
  }
  async set(css,guard) {
    const result=await this.protocol.evaluate(`(() => {
      const guard=${JSON.stringify(guard)};
      if(!guard||String(performance.timeOrigin)!==guard.documentToken||JSON.stringify(${structureExpression})!==guard.structureKey)return {changed:true};
      const all=document.querySelectorAll('#${STYLE_ID}');
      if(all.length>1)throw new Error('Ambiguous theme style');
      let style=all[0];
      if(style&&style.dataset.owner!=='${OWNER}')throw new Error('Style owner mismatch');
      if(!style){style=document.createElement('style');style.id='${STYLE_ID}';style.dataset.owner='${OWNER}';document.head.append(style);}
      style.textContent=${JSON.stringify(css)};
      return {applied:!!style.sheet&&style.sheet.cssRules.length>0};
    })()`);
    if(result?.changed){const error=new Error('Document or layout changed before committing the theme');error.code='LAYOUT_CHANGED';throw error;}
    if(!result?.applied)throw new Error('The application rejected the theme stylesheet');
  }
  async remove() {
    await this.protocol.evaluate(`(() => {
      const styles=document.querySelectorAll('#${STYLE_ID}');
      if([...styles].some(s=>s.dataset.owner!=='${OWNER}'))throw new Error('Style owner mismatch');
      for(const style of styles)style.remove();
      return true;
    })()`);
  }
}
module.exports={StyleHost,STYLE_ID};
