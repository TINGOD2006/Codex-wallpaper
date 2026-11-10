const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {mountWallpaperPanel}=require('./panel-dom.js'),{isRootContext}=require('./commands.cjs');
const {detectLayout,structureExpression}=require('../adapters.cjs');
const {FULL_WINDOW_MATERIALS}=require('./styles.cjs');
class WallpaperPanel {
 constructor(protocol,{sessionId,appVersion}){this.client=protocol;this.sessionId=sessionId;this.appVersion=appVersion;this.panelId=randomUUID();this.binding='__codexWallpaper_'+this.panelId.replaceAll('-','');this.contexts=new Map();this.ready=false}
 async mount(handler){
  const layout=detectLayout(await this.client.evaluate(structureExpression),this.appVersion);if(!['codex','chatgpt'].includes(layout.kind))throw new Error('目前版型尚未支援 Wallpaper 設定');
  this.handler=handler;this.frame=(await this.client.send('Page.getFrameTree')).frameTree.frame;if(this.frame.url!=='app://-/index.html')throw new Error('Not the managed app frame');
  this.listener=event=>{
   if(event.method==='Runtime.executionContextCreated'){const ctx=event.params.context;this.contexts.set(ctx.id,ctx)}
   if(event.method==='Runtime.executionContextDestroyed')this.contexts.delete(event.params.executionContextId);
   if(event.method==='Runtime.executionContextsCleared'){this.contexts.clear();this.ready=false}
   if(event.method==='Runtime.bindingCalled'&&event.params.name===this.binding&&this.ready&&isRootContext(this.contexts.get(event.params.executionContextId),this.frame))this.handle(event.params).catch(()=>{});
  };
  this.client.on('notification',this.listener);try{await this.client.send('Runtime.enable');await this.client.send('Runtime.addBinding',{name:this.binding});const css=await fs.readFile(path.join(__dirname,'panel.css'),'utf8');this.ready=await this.client.evaluate(`(${mountWallpaperPanel.toString()})(${JSON.stringify({sessionId:this.sessionId,panelId:this.panelId,binding:this.binding,css,fullWindowMaterials:FULL_WINDOW_MATERIALS})})`);return this.ready}catch(e){await this.unmount();throw e}
 }
 async handle(event){
  if(typeof event.payload!=='string'||event.payload.length>65536)return;let command;try{command=JSON.parse(event.payload)}catch{return}
  const reply=await this.handler.dispatch(command);if(!this.ready||reply.panelId!==this.panelId)return;
  await this.client.send('Runtime.evaluate',{expression:`window.__codexWallpaperPanel?.panelId===${JSON.stringify(this.panelId)}&&window.__codexWallpaperPanel.receive(${JSON.stringify(reply)})`,contextId:event.executionContextId,returnByValue:true});
 }
 async update(snapshot,cards,presets){if(!this.ready)return false;return this.client.evaluate(`(()=>{const p=window.__codexWallpaperPanel;if(p?.panelId!==${JSON.stringify(this.panelId)}||!document.getElementById('codex-wallpaper-button'))return false;p.update(${JSON.stringify({...snapshot,cards,presets})});return true})()`)}
 async unmount(){this.ready=false;this.handler?.close();if(this.listener)this.client.off('notification',this.listener);if(this.client.connected){try{await this.client.send('Runtime.removeBinding',{name:this.binding});await this.client.evaluate(`window.__codexWallpaperPanel?.panelId===${JSON.stringify(this.panelId)}&&window.__codexWallpaperPanel.dispose()`)}catch{}}this.contexts.clear()}
}
module.exports={WallpaperPanel};
