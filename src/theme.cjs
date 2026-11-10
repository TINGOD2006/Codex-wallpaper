const {validateConfig}=require('./config.cjs');
const {loginSelectors,desktopSelectors}=require('./adapters.cjs');
function rgba(hex,alpha) {
  return `rgba(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)},${alpha})`;
}
function buildScrim(config){const p=config.palette;return `linear-gradient(90deg,${rgba(p.surface,Math.min(1,config.overlayOpacity+.14))} 0%,${rgba(p.surface,Math.min(1,config.overlayOpacity+.12))} 45%,${rgba(p.surface,Math.min(1,config.overlayOpacity+.06))} 68%,${rgba(p.surface,Math.max(0,config.overlayOpacity-.16))} 100%),linear-gradient(270deg,${p.surface} 64px,${rgba(p.surface,0)} 192px)`;}
function buildThemeCss(config,image,layout) {
  validateConfig(config);
  if(!['login','codex','chatgpt'].includes(layout.kind))throw new Error('Unsupported layout; theme was not applied');
  const selectors=layout.kind==='login'?loginSelectors:desktopSelectors;
  if(!['image/png','image/jpeg','image/webp'].includes(image.mime) || !new RegExp(`^data:${image.mime};base64,[A-Za-z0-9+/]+={0,2}$`).test(image.dataUri))throw new Error('Invalid encoded background image');
  const p=config.palette;
  const variables={
    '--app-color-background-surface':p.surface,
    '--app-color-background-surface-under':p.surface,
    '--app-color-background-elevated-primary':rgba(p.panel,.96),
    '--app-color-background-elevated-primary-opaque':p.panel,
    '--app-color-background-elevated-secondary':rgba(p.panel,.94),
    '--app-color-background-elevated-secondary-opaque':p.panel,
    '--app-color-background-elevated-tertiary-opaque':p.panel,
    '--app-color-background-application-menu':p.panel,
    '--app-color-background-control':p.panel,
    '--color-background-control-opaque':p.panel,
    '--color-background-panel':rgba(p.panel,.96),
    '--color-background-composer-primary':p.panel,
    '--color-background-composer-action-bar':p.panel,
    '--color-text-composer-primary':p.text,
    '--app-color-background-button-primary':p.accent,
    '--app-color-background-button-primary-hover':p.muted,
    '--app-color-text-button-primary':p.surface,
    '--app-color-text-button-secondary':p.text,
    '--app-color-background-accent':p.selection,
    '--app-color-background-accent-active':p.selection,
    '--app-color-background-accent-hover':p.selection,
    '--app-color-icon-accent':p.accent,
    '--app-color-icon-primary':p.text,
    '--app-color-icon-secondary':p.muted,
    '--app-color-text-accent':p.accent,
    '--app-color-text-foreground':p.text,
    '--app-color-text-foreground-secondary':p.muted,
    '--app-color-text-foreground-tertiary':rgba(p.muted,.78),
    '--app-color-border':rgba(p.muted,.2),
    '--app-color-border-light':rgba(p.muted,.12),
    '--app-color-border-heavy':rgba(p.muted,.3),
    '--app-color-border-focus':p.accent
  };
  return `/* miku-desktop-theme: temporary stylesheet */\n:root {\n${Object.entries(variables).map(([key,value])=>`  ${key}: ${value} !important;`).join('\n')}\n}\n${selectors.canvas} {
  background-color: ${p.surface} !important;
  background-image: ${buildScrim(config)},url('${image.dataUri}') !important;
  background-size: cover !important;
  background-position: center,center,calc(${config.positionX}% - 64px) center !important;
  background-repeat: no-repeat !important;
}\n${layout.kind==='login'?`${loginSelectors.transparentSurface} { background-color: transparent !important; }`:`${desktopSelectors.frame},${desktopSelectors.sidebar} { background-color: ${p.surface} !important; }
${desktopSelectors.composer} { background-color: ${rgba(p.panel,.97)} !important; }
${desktopSelectors.canvas} .bg-surface { background-color: ${rgba(p.panel,.96)} !important; }`}\n`;
}
module.exports={buildThemeCss,buildScrim};
