const {SceneEngine}=require('./scene-engine.cjs');
const {delay}=require('./control.cjs');
const {buildScrim}=require('./theme.cjs');
const LAYER_ID='miku-live-scene-layer';
class SceneBridge {
  constructor(protocol,config,theme,windowVisible){this.client=protocol;this.config=config;this.theme=theme;this.windowVisible=windowVisible;this.active=false;this.closed=false;this.status={state:'stopped',frames:0};}
  async setActive(value){
    if(value&&this.active&&this.status.state==='error')return;
    this.active=value;
    if(!value){await this.remove();if(this.engine)await this.engine.pause().catch(()=>{});this.status={...this.status,state:this.engine?'paused':'stopped'};return;}
    if(!this.task){this.closed=false;this.task=this.run().finally(()=>{this.task=null});}
  }
  async remove(){if(this.client.connected)await this.client.evaluate(`(()=>{const e=document.getElementById('${LAYER_ID}');if(e?.dataset.owner==='miku-desktop-theme')e.remove()})()`);}
  async run(){
    try{
      this.status={state:'loading',frames:0};this.engine=new SceneEngine(this.config);await this.engine.start();
      let frames=0;let samples=[];
      while(!this.closed&&this.client.connected){
        const then=Date.now();
        const host=await this.client.evaluate(`(()=>{const m=document.querySelector('[data-app-shell-active-page="true"] main[data-app-shell-main-surface="default"]');return {visible:!document.hidden,main:!!m&&m.checkVisibility(),themed:!!document.getElementById('miku-desktop-theme-v1')}})()`);
        const visible=this.windowVisible?this.windowVisible():host.visible;
        if(!this.active||!host.main||!host.themed||(this.config.pauseWhenHidden&&!visible)){
          await this.engine.pause();this.status={...this.engine.status,state:'paused',reason:!this.active?'disabled':'hidden'};
          samples=[];
          await delay(250);continue;
        }
        if(this.engine.status.state==='paused')await this.engine.resume();
        const frame=await this.engine.frame();if(!this.active||this.closed)continue;
        await this.client.evaluate(`(()=>{
          if(!document.getElementById('miku-desktop-theme-v1'))return;
          const main=document.querySelector('[data-app-shell-active-page="true"] main[data-app-shell-main-surface="default"]');if(!main)return;
          let layer=document.getElementById('${LAYER_ID}');
          if(layer&&layer.dataset.owner!=='miku-desktop-theme')throw new Error('Scene layer owner mismatch');
          if(layer&&layer.parentElement!==main){layer.remove();layer=null;}
          if(!layer){
            layer=document.createElement('div');layer.id='${LAYER_ID}';layer.dataset.owner='miku-desktop-theme';layer.setAttribute('aria-hidden','true');
            layer.style.cssText='position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:-1;background:${this.theme.palette.surface}';
            const image=document.createElement('img');image.alt='';image.style.cssText='position:absolute;width:100%;height:100%;object-fit:cover;transform:translateX(-64px);pointer-events:none';
            const scrim=document.createElement('div');scrim.style.cssText='position:absolute;inset:0;pointer-events:none';scrim.style.backgroundImage=${JSON.stringify(buildScrim(this.theme))};
            layer.append(image,scrim);main.prepend(layer);
          }
          layer.firstElementChild.src=${JSON.stringify(frame)};
        })()`);
        frames++;samples.push(Date.now());if(samples.length>20)samples.shift();
        this.status={...this.engine.status,state:'playing',displayedFrames:frames,displayFps:samples.length>1?Math.round((samples.length-1)*10000/(samples.at(-1)-samples[0]))/10:0};
        await delay(Math.max(0,1000/this.config.displayFps-(Date.now()-then)));
      }
    }catch(e){this.status={state:'error',error:e.message};await this.remove().catch(()=>{});}
    finally{await this.engine?.close();}
  }
  async close(){this.closed=true;this.active=false;await this.engine?.close();await this.task;await this.remove().catch(()=>{});}
}
module.exports={SceneBridge,LAYER_ID};
