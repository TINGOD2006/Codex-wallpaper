const {loadImage}=require('./config.cjs');
const {detectLayout,guardFor}=require('./adapters.cjs');
const {buildThemeCss}=require('./theme.cjs');
class ThemeSession {
  #queue=Promise.resolve(); #revision=0; #css=null; #config=null; #layout=null;
  constructor(host,{appVersion}) {
    this.host=host;this.appVersion=appVersion;this.enabled=false;
    this.status={state:'disabled',layout:'unknown',enabled:false};
  }
  #enqueue(work){const result=this.#queue.then(work);this.#queue=result.catch(()=>{});return result;}
  #status(state,layout=this.#layout?.kind||'unknown',reason){this.status={state,layout,enabled:this.enabled,...reason?{reason}:{}};return {...this.status};}
  async #perform(config,revision) {
    const snapshot=await this.host.inspect();
    const layout=detectLayout(snapshot,this.appVersion);
    if(revision!==this.#revision||!this.enabled)return {...this.status};
    if(layout.kind==='unsupported'){
      try{await this.host.remove();this.#css=null;}catch(error){this.#status('restore-unconfirmed',layout.kind,error.message);throw error;}
      this.#config=config;this.#layout=layout;
      return this.#status('unsupported',layout.kind,layout.reason);
    }
    if(snapshot.themeStylePresent===false){this.#css=null;this.#status('disabled',layout.kind,'Theme is not present in the current document');}
    const image=await loadImage(config.backgroundPath);
    const css=buildThemeCss(config,image,layout);
    await this.host.validateImage(image.dataUri);
    if(revision!==this.#revision||!this.enabled)return {...this.status};
    const previous=this.#css;
    const guard=guardFor(snapshot);
    try{await this.host.set(css,guard);}
    catch(error){
      if(error.code==='LAYOUT_CHANGED'){
        this.#config=config;
        try{await this.host.remove();this.#css=null;this.#layout=detectLayout(await this.host.inspect(),this.appVersion);this.#status(this.#layout.kind==='unsupported'?'unsupported':'disabled',undefined,error.message);}
        catch{this.#status('restore-unconfirmed',undefined,'Layout changed and theme removal could not be confirmed');}
        throw error;
      }
      try{previous===null?await this.host.remove():await this.host.set(previous,guard);this.#status(previous===null?'disabled':'applied',undefined,error.message);}
      catch{
        try{await this.host.remove();this.#css=null;this.#status('disabled',undefined,'Theme update failed; partial styles were removed');}
        catch{this.#status('restore-unconfirmed',undefined,'Theme update and rollback could not be confirmed');}
      }
      throw error;
    }
    if(revision!==this.#revision||!this.enabled){try{await this.host.remove();this.#css=null;return this.#status('disabled');}catch(error){return this.#status('restore-unconfirmed',undefined,error.message);}}
    this.#css=css;this.#config=config;this.#layout=layout;
    return this.#status('applied',layout.kind);
  }
  apply(config){this.enabled=true;const revision=++this.#revision;return this.#enqueue(()=>this.#perform(config,revision));}
  disable(){
    this.enabled=false;++this.#revision;
    return this.#enqueue(async()=>{
      try{await this.host.remove();this.#css=null;return this.#status('disabled');}
      catch(error){return this.#status('restore-unconfirmed',undefined,error.message);}
    });
  }
  refresh({documentReloaded=false}={}) {
    return this.#enqueue(async()=>{
      if(!this.enabled){
        if(this.#css!==null||this.status.state==='restore-unconfirmed'){
          try{await this.host.remove();this.#css=null;return this.#status('disabled');}catch(error){return this.#status('restore-unconfirmed',undefined,error.message);}
        }
        return {...this.status};
      }
      if(!this.#config)return {...this.status};
      const structure=await this.host.inspect();
      const layout=detectLayout(structure,this.appVersion);
      if(!documentReloaded&&layout.kind===this.#layout?.kind&&((layout.kind==='unsupported'&&this.#css===null)||(this.status.state==='applied'&&structure.themeStylePresent!==false)))return {...this.status};
      return this.#perform(this.#config,this.#revision);
    });
  }
  async rebind(host){this.host=host;return this.refresh({documentReloaded:true});}
  connectionLost(){return this.#status(this.#css!==null?'restore-unconfirmed':'disconnected',undefined,'Connection lost; restoration is not yet confirmed');}
  async close(){return this.disable();}
}
module.exports={ThemeSession};
