const {validateSettings}=require('./schema.cjs');
const {desktopSelectors,MATERIAL_REGIONS}=require('../adapters.cjs');
const mix=(color,alpha)=>`color-mix(in srgb, ${color} ${Math.round(Math.max(0,Math.min(1,alpha))*10000)/100}%, transparent)`;
const FULL_WINDOW_MATERIALS={chat:{enabled:true,alpha:0,blur:0,border:0},sidebar:{enabled:true,alpha:.4,blur:0,border:.06},composer:{enabled:true,alpha:.6,blur:0,border:.12},titlebar:{enabled:true,alpha:.5,blur:0,border:0},panels:{enabled:true,alpha:.55,blur:0,border:.1},overlays:{enabled:true,alpha:.85,blur:0,border:.12}};
function buildWallpaperStyles(settings,layout){
  validateSettings(settings);if(!['codex','chatgpt'].includes(layout.kind))throw new Error('Unsupported wallpaper layout');
  if(!settings.enabled)return {background:'',materials:'',colors:''};
  const r=settings.reading,p=settings.colors.palette,surface='var(--app-color-background-surface, Canvas)',mask=r.maskColor||surface;
  let background='';
  if(settings.wallpaper.enabled){
    const cover=r.fit==='cover'&&r.scale>=1,expandX=cover?Math.abs(r.offsetX):0,expandY=cover?Math.abs(r.offsetY):0;
    const filter=r.brightness===1&&r.contrast===1&&r.saturation===1&&r.blur===0?'none':`brightness(${r.brightness}) contrast(${r.contrast}) saturate(${r.saturation}) blur(${r.blur}px)`;
    const edge=cover?'':r.offsetX<0?`,linear-gradient(270deg,${mask} ${-r.offsetX}px,transparent ${-r.offsetX+128}px)`:r.offsetX>0?`,linear-gradient(90deg,${mask} ${r.offsetX}px,transparent ${r.offsetX+128}px)`:'';
    background=`${desktopSelectors.frame}{isolation:isolate;} ${desktopSelectors.canvas}{background-color:transparent!important;background-image:none!important;}
/* Measured native thread-footer decorations; keep the actual composer surface intact. */
${desktopSelectors.canvas} [data-app-action-timeline-scroll] .pointer-events-none[class*="_background_18hic_"]:is([class*="_fade_18hic_"],[class*="_surface_18hic_"]){background-color:transparent!important;background-image:none!important;}
#codex-wallpaper-layer{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:-1;background:${surface};}
#codex-wallpaper-image{position:absolute;left:${-expandX}px;top:${-expandY}px;width:calc(100% + ${expandX*2}px);height:calc(100% + ${expandY*2}px);max-width:none;object-fit:${r.fit==='stretch'?'fill':r.fit};object-position:${r.x}% ${r.y}%;opacity:${r.opacity};filter:${filter};transform:translate(${r.offsetX}px,${r.offsetY}px) scale(${r.scale}) scaleX(${r.flip?-1:1});pointer-events:none;}
#codex-wallpaper-scrim{position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,${mix(mask,r.scrim+.14)} 0%,${mix(mask,r.scrim+.12)} 45%,${mix(mask,r.scrim+.06)} 68%,${mix(mask,r.scrim-.16)} 100%)${edge};}`;
  }
  let materials='';for(const [key,targets]of Object.entries(MATERIAL_REGIONS)){
    const m=settings.materials[key];if(!m.enabled)continue;const selector=`:is(${targets})`;
    materials+=`${selector}{background-color:${mix(surface,m.alpha)}!important;backdrop-filter:${m.blur?`blur(${m.blur}px)`:'none'}!important;box-shadow:${m.border?`inset 0 0 0 1px ${mix('var(--app-color-text-foreground, CanvasText)',m.border)}`:'none'};}`;
    if(key==='sidebar'||key==='composer'||key==='titlebar')materials+=`${selector} :is(.bg-surface,.bg-surface-under){background-color:transparent!important;}`;
    // The native list adds a second translucent fill inside the sidebar surface.
    // Keep row selection/hover fills; only the measured list container is cleared.
    if(key==='sidebar')materials+=`${desktopSelectors.sidebar} .sidebar-navigation{background-color:transparent!important;background-image:none!important;}`;
    if(key==='chat')materials+=`${desktopSelectors.canvas} [class*="_MainContentTopFade_"]{background-image:none!important;}`;
    if(key==='panels')materials+=`${selector} :is(.bg-surface,.bg-surface-elevated-secondary,.cm-scroller,.cm-content,.cm-gutters),${selector} .bg-surface-elevated-secondary::before{background-color:transparent!important;}`;
  }
  let colors='';if(settings.colors.enabled){
    const vars={'--app-color-background-surface':p.surface,'--app-color-background-surface-under':p.surface,'--app-color-background-elevated-primary':p.panel,'--app-color-background-elevated-primary-opaque':p.panel,'--app-color-background-elevated-secondary':p.panel,'--app-color-background-control':p.panel,'--color-background-composer-primary':p.panel,'--app-color-text-foreground':p.text,'--app-color-text-foreground-secondary':p.muted,'--app-color-text-accent':p.accent,'--app-color-icon-accent':p.accent,'--app-color-background-accent':p.selection};
    colors=`:root{${Object.entries(vars).map(([k,v])=>`${k}:${v}!important;`).join('')}}`;
  }
  return {background,materials,colors};
}
module.exports={buildWallpaperStyles,MATERIAL_REGIONS,FULL_WINDOW_MATERIALS};
