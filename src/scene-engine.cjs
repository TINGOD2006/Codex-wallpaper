const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {createSceneServer,createMediaServer}=require('./scene-server.cjs');
const {Protocol}=require('./protocol.cjs');
const {delay}=require('./control.cjs');
const {FrameStream}=require('./frame-stream.cjs');
const {jpegDimensions}=require('./jpeg-frame.cjs');
class SceneEngine {
  constructor(config){this.config=config;this.status={state:'stopped',frames:0};}
  get eventDriven(){return this.stream?.active===true}
  get fallbackMode(){return !this.config.entry||this.config.entry.kind==='scene'?'screenshot':'canvas'}
  async nextFrame(){const stream=this.stream;if(stream)try{await stream.next()}catch(e){if(this.stream===stream){this.stream=null;await stream.close();this.status={...this.status,captureMode:this.fallbackMode,captureFallback:e.message}}}return this.frame()}
  async start(){
    try{
      const cancelled=()=>{if(this.config.signal?.aborted)throw new Error('Wallpaper load cancelled')};cancelled();
      this.abortListener=()=>{this.close().catch(()=>{})};this.config.signal?.addEventListener('abort',this.abortListener,{once:true});
      this.status={state:'loading',frames:0};
      this.server=this.config.entry?await createMediaServer(this.config.entry):await createSceneServer(this.config);
      cancelled();
      const candidates=[path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe'),path.join(process.env.ProgramFiles||'C:/Program Files','Microsoft/Edge/Application/msedge.exe')];
      let executable;for(const candidate of candidates){try{await fs.access(candidate);executable=candidate;break}catch{}}
      if(!executable)throw new Error('Microsoft Edge is required for the isolated Scene renderer');
      this.profile=path.join(this.config.runtimeRoot||path.resolve(__dirname,'../.state'),'renderers',randomUUID());await fs.mkdir(this.profile,{recursive:true});
      cancelled();
      this.child=spawn(executable,['--headless=new','--edge-skip-compat-layer-relaunch','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${this.profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--autoplay-policy=no-user-gesture-required',`--window-size=${this.config.width},${this.config.height}`,this.server.url],{windowsHide:true,stdio:'ignore'});
      let spawnError;this.child.on('error',e=>{spawnError=e});
      let port;
      for(let i=0;i<80;i++){cancelled();if(spawnError)throw spawnError;try{port=Number((await fs.readFile(path.join(this.profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break}catch{}if(this.child.exitCode!==null)throw new Error('Isolated renderer exited');await delay(150)}
      if(!port)throw new Error('Isolated renderer debug endpoint timed out');
      const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(3000)})).json();
      const target=targets.find(t=>t.type==='page'&&t.url===this.server.url);if(!target)throw new Error('Dedicated renderer page not found');
      const u=new URL(target.webSocketDebuggerUrl);if(u.protocol!=='ws:'||u.hostname!=='127.0.0.1'||Number(u.port)!==port||u.username||u.password)throw new Error('Untrusted renderer endpoint');
      const socket=new WebSocket(u);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.close();reject(new Error('Renderer connection timeout'))},5000);socket.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true});socket.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('Renderer connection failed'))},{once:true})});
      this.client=new Protocol(socket,{timeoutMs:15000});
      cancelled();
      await this.client.send('Page.enable');await this.client.send('Emulation.setDeviceMetricsOverride',{width:this.config.width,height:this.config.height,deviceScaleFactor:1,mobile:false});
      for(let i=0;i<160;i++){
        cancelled();
        const s=await this.client.evaluate('window.codexSceneStatus||null');
        if(s?.state==='error')throw new Error(s.error);
        if(s?.state==='ready'){
          await this.client.evaluate(`codexScene.setFps(${this.config.renderFps})`);
          if(!this.config.entry||this.config.entry.kind==='scene'){
            const stream=new FrameStream(this.client,{...this.config,displayFps:this.config.displayFps||this.config.renderFps});this.stream=stream;
            try{await stream.start()}catch(e){await stream.close();this.stream=null;if(this.config.signal?.aborted)throw e;this.captureFallback=e.message}
          }
          cancelled();this.status={state:'ready',frames:0,title:this.server.title,diagnostics:s.diagnostics,captureMode:this.stream?'screencast':this.fallbackMode,captureFallback:this.captureFallback};return this.status;
        }
        await delay(250);
      }
      throw new Error('Scene first-frame timeout');
    }catch(e){await this.close();this.status={state:'error',error:e.message,frames:0};throw e}
  }
  async frame(){
    if(!this.client?.connected)throw new Error('Scene renderer is disconnected');
    if(this.status.state==='error')throw new Error(this.status.error);
    if(this.stream?.failure){const stream=this.stream;this.stream=null;await stream.close();this.status={...this.status,captureMode:this.fallbackMode,captureFallback:stream.failure.message}}
    if(this.stream?.frame){
      if(!this.statsJob&&Date.now()-(this.lastStats||0)>1000){
        const client=this.client;this.lastStats=Date.now();this.statsJob=client.evaluate('({state:codexSceneStatus,stats:codexScene.stats})').then(s=>{if(client!==this.client)return;if(s.state.state==='error')this.status={...this.status,state:'error',error:s.state.error};else this.status.renderFps=Math.round(s.stats.fps||0)}).catch(()=>{}).finally(()=>{this.statsJob=null});
      }
      this.status={...this.status,frames:this.status.frames+1,captureFps:this.stream.fps,captureDiagnostics:this.stream.diagnostics};return this.stream.frame;
    }
    const compositor=this.fallbackMode==='screenshot';
    const state=await this.client.evaluate(compositor?'({state:codexSceneStatus,stats:codexScene.stats,paused:codexScene.paused})':'({state:codexSceneStatus,stats:codexScene.stats,paused:codexScene.paused,image:codexScene.canvas?.toDataURL("image/jpeg",0.92)})');
    if(state.state.state==='error')throw new Error(state.state.error);
    if(compositor){const {width,height}=this.config,result=await this.client.send('Page.captureScreenshot',{format:'jpeg',quality:this.config.captureQuality||92,fromSurface:true,captureBeyondViewport:true,clip:{x:0,y:0,width,height,scale:1}}),size=jpegDimensions(result.data);if(size?.width!==width||size?.height!==height)throw new Error('Fallback capture dimensions do not match the requested quality');state.image='data:image/jpeg;base64,'+result.data}
    if(!state.image?.startsWith('data:image/jpeg;base64,'))throw new Error('Scene framebuffer unavailable');
    this.status={...this.status,state:state.paused?'paused':'ready',renderFps:Math.round(state.stats.fps||0),frames:this.status.frames+1};
    return state.image;
  }
  playbackOperation(work){if(this.closing)return Promise.resolve();const job=(this.playbackTail||Promise.resolve()).then(work);this.playbackTail=job.catch(()=>{});return job}
  pause(){return this.playbackOperation(async()=>{if(this.client?.connected){await this.client.evaluate('window.codexScene?.pause()');await this.stream?.stop();this.status={...this.status,state:'paused'}}})}
  resume(){return this.playbackOperation(async()=>{if(this.client?.connected){await this.client.evaluate('window.codexScene?.resume()');await this.stream?.start();this.status={...this.status,state:'ready'}}})}
  setPlayback(playback){return this.playbackOperation(async()=>{if(this.client?.connected){await this.client.evaluate(`(()=>{codexScene.setFps(${playback.renderFps});codexScene.setVolume(${playback.muted?0:playback.volume});${playback.paused?'codexScene.pause()':'codexScene.resume()'}})()`);this.status={...this.status,state:playback.paused?'paused':'ready'};if(this.stream){await this.stream.configure(playback);if(playback.paused)await this.stream.stop();else await this.stream.start()}}})}
  async close(){
    if(this.closing)return this.closing;this.closing=this.closeResources();return this.closing;
  }
  async closeResources(){
    if(this.abortListener)this.config.signal?.removeEventListener('abort',this.abortListener);
    await this.playbackTail;
    await this.stream?.close();this.stream=null;
    const client=this.client;this.client=null;
    if(client?.connected){try{await client.send('Browser.close')}catch{}client.close()}
    if(this.child&&this.child.exitCode===null){try{this.child.kill()}catch{}}
    if(this.server){await this.server.close();this.server=null}
    this.status={...this.status,state:'stopped'};
  }
}
module.exports={SceneEngine};
