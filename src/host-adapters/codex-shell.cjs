const SUPPORTED_VERSIONS=['26.1021.3705.0','26.1023.6123.0','26.1023.6621.0'];
const ADAPTER_VERSION='1.0.5';
const loginSelectors=Object.freeze({canvas:'#root > .zoom-adjusted-viewport:not(.pointer-events-none)',transparentSurface:'#root .flex.h-full.w-full.bg-surface'});
const frame='[data-app-shell-frame="true"]';
const main='main[data-app-shell-main-surface="default"]';
const inactive=':is([inert],[data-app-shell-active-page="false"],[data-app-shell-active-page]:is([hidden],[aria-hidden="true"]),[data-composer-surface-variant]:is([hidden],[aria-hidden="true"]))';
const available=`:not(${inactive},${inactive} *)`;
const activePage=`[data-app-shell-active-page="true"]${available}`;
// Codex can wrap the main surface with the active page or mount it inside main.
const canvas=`${frame} :is(${activePage} ${main},${main}:has(${activePage}))${available}`;
const composerBody=`${activePage} [data-composer-body]${available}`;
const desktopSelectors=Object.freeze({canvas,frame,sidebar:'.app-shell-left-panel',composer:composerBody});
const MATERIAL_REGIONS=Object.freeze({chat:desktopSelectors.canvas,sidebar:desktopSelectors.sidebar,composer:`${activePage} [data-composer-surface-variant]${available}`,titlebar:'[data-app-shell-titlebar="true"],[data-app-shell-frame="true"] > [class*="_ApplicationMenuTopBar_"]',panels:'[data-app-shell-frame="true"] [class~="group/summary-panel"],[data-app-shell-frame="true"] [data-app-shell-right-panel],[data-app-shell-frame="true"] [data-editor-search-surface="true"] .cm-editor',overlays:'#codex-wallpaper-panel[data-owner="codex-wallpaper"],[role="dialog"],[role="menu"][data-state="open"],[data-radix-popper-content-wrapper] > [data-state="open"]'});
function sampleShell(canvasSelector,composerSelector,inactiveSelector,regions){
 const visibility=new Map();
 const visible=element=>{
  if(visibility.has(element))return visibility.get(element);
  if(element.closest('#codex-wallpaper-panel[data-owner="codex-wallpaper"],#codex-wallpaper-button[data-owner="codex-wallpaper"]')){
   visibility.set(element,false);return false;
  }
  const rect=element.getBoundingClientRect();
  const result=rect.width>0&&rect.height>0&&element.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
  visibility.set(element,result);return result;
 };
 // Native tabs can retain an inactive editor in the DOM, even during a
 // transition where it still has a nonzero rectangle.
 const count=selector=>{
  let total=0;for(const element of document.querySelectorAll(selector))if(visible(element))total++;
  return total;
 };
 let editorCount=0,composerEditorCount=0,auxiliaryEditorCount=0,requestEditorCount=0;
 for(const editor of document.querySelectorAll('textarea,[contenteditable="true"]')){
  if(editor.closest(inactiveSelector)||!visible(editor))continue;
  editorCount++;
  if(editor.parentElement?.closest(composerSelector))composerEditorCount++;
  if(editor.matches('[data-editor-search-surface="true"] .cm-editor .cm-content[contenteditable="true"][role="textbox"]'))auxiliaryEditorCount++;
  if(editor.matches('[data-app-shell-active-page="true"] [data-codex-composer-request-navigation] [data-request-input-other-row] [data-rich-text-layout] [contenteditable="true"][role="textbox"]'))requestEditorCount++;
 }
 let mode=null;
 for(const button of document.querySelectorAll('.app-shell-left-panel button[aria-haspopup="menu"][aria-label]')){
  const match=(button.getAttribute('aria-label')||'').match(/(?:mode|模式).*[:：]\s*(Codex|ChatGPT)\s*$/i);
  if(!match||!visible(button))continue;
  if(mode){mode=null;break}
  mode=match[1].toLowerCase();
 }
 const frames=document.querySelectorAll('[data-app-shell-frame="true"]');
 return {
  rootViewportCount:count('#root > .zoom-adjusted-viewport:not(.pointer-events-none)'),
  editorCount,composerEditorCount,auxiliaryEditorCount,requestEditorCount,
  activeMainSurfaceCount:count(canvasSelector),
  frameCount:frames.length===1?Number(visible(frames[0])):frames.length,
  composerBodyCount:count(composerSelector),
  mode,
  ...(regions?{
   loginSurfaceCount:count('#root .flex.h-full.w-full.bg-surface'),
   buttonCount:count('button'),
   regions:Object.fromEntries(Object.entries(regions).map(([key,selector])=>[key,count(selector)]))
  }:{})
 };
}
const shellExpression=(regions)=>`(${sampleShell.toString()})(${JSON.stringify(canvas)},${JSON.stringify(composerBody)},${JSON.stringify(inactive)},${JSON.stringify(regions)})`;
const structureExpression=shellExpression(MATERIAL_REGIONS);
const desktopContractExpression=shellExpression(null);
function contractChecks(s){const composer=s?.composerEditorCount??1,auxiliary=s?.auxiliaryEditorCount??0,requests=s?.requestEditorCount??0;return [{id:'desktop-root',passed:s?.rootViewportCount===0},{id:'unique-frame',passed:s?.frameCount===1},{id:'active-main',passed:s?.activeMainSurfaceCount===1},{id:'composer',passed:s?.composerBodyCount===1&&(s.composerEditorCount===undefined||s.composerEditorCount===1)},{id:'mode',passed:['codex','chatgpt'].includes(s?.mode)},{id:'editors',passed:composer===1&&Number.isInteger(auxiliary)&&auxiliary>=0&&auxiliary<=1&&Number.isInteger(requests)&&requests>=0&&requests<=3&&s?.editorCount===composer+auxiliary+requests}]}
function composerIsPending(s,checks){
 if(s?.composerEditorCount!==0||![0,1].includes(s.composerBodyCount))return false;
 const auxiliary=s.auxiliaryEditorCount??0,requests=s.requestEditorCount??0;
 return Number.isInteger(auxiliary)&&auxiliary>=0&&auxiliary<=1&&
  Number.isInteger(requests)&&requests>=0&&requests<=3&&
  s.editorCount===auxiliary+requests&&
  checks.every(check=>check.passed||check.id==='composer'||check.id==='editors');
}
function detectLayout(s,appVersion){
 const known=SUPPORTED_VERSIONS.includes(appVersion),requiredChecks=contractChecks(s),ok=requiredChecks.every(check=>check.passed);
 const base={ok,adapterId:'codex-shell',adapterVersion:ADAPTER_VERSION,requiredChecks,compatibility:ok?(known?'validated':'structural'):'incompatible'};
 if(known&&s?.rootViewportCount===1&&s.loginSurfaceCount===1&&s.editorCount===0&&[3,5].includes(s.buttonCount))return {...base,kind:'login',selectors:loginSelectors,reason:'Measured unauthenticated desktop layout'};
 if(!ok)return {...base,kind:'unsupported',composerPending:composerIsPending(s,requiredChecks),reason:'Required desktop structure failed: '+requiredChecks.filter(check=>!check.passed).map(check=>check.id).join(', ')};
 const regions=Object.fromEntries(['chat','sidebar','composer','titlebar','panels','overlays'].map(key=>[key,{supported:true,reason:s.regions?.[key]===0?'not-mounted':null}]));
 return {...base,kind:s.mode,selectors:desktopSelectors,regions,reason:known?'Measured authenticated desktop shell':'Structurally compatible desktop shell; version not manually validated'};
}
module.exports={SUPPORTED_VERSIONS,ADAPTER_VERSION,loginSelectors,desktopSelectors,MATERIAL_REGIONS,structureExpression,desktopContractExpression,contractChecks,detectLayout};
