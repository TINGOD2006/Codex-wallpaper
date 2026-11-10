const {jpegDimensions}=require('./jpeg-frame.cjs');
// One latest frame, no frame queue. Chrome owns capture/encoding; the app receives only JPEGs.
class FrameStream {
  constructor(client,options,{measureFrame=jpegDimensions}={}){
    this.client=client;this.options=options;this.frame=null;this.active=false;this.closed=false;this.epoch=0;this.samples=[];this.sequence=0;this.consumed=0;
    this.listener=event=>{
      if(event.method!=='Page.screencastFrame')return;
      const p=event.params;
      this.received=(this.received||0)+1;this.lastEventAt=Date.now();this.lastViewport=[p.metadata?.deviceWidth,p.metadata?.deviceHeight];
      client.send('Page.screencastFrameAck',{sessionId:p.sessionId}).catch(()=>{});
      if(!this.active||this.closed)return;
      if(Math.abs(p.metadata?.deviceWidth-options.width)>.5||Math.abs(p.metadata?.deviceHeight-options.height)>.5){this.repairViewport(p.metadata);return}
      if(typeof p.data!=='string'||!p.data||p.data.length>16*1024*1024-32)return;
      const size=measureFrame(p.data);if(!size)return;
      if(size.width!==options.width||size.height!==options.height){this.repairViewport({deviceWidth:size.width,deviceHeight:size.height});return}
      this.frame='data:image/jpeg;base64,'+p.data;this.sequence++;this.samples.push(Date.now());if(this.samples.length>30)this.samples.shift();
      if(this.waiter){this.consumed=this.sequence;this.waiter.resolve(this.frame)}
      this.ready?.resolve();
    };
    client.on('notification',this.listener);
    this.disconnected=()=>{this.active=false;this.waiter?.resolve(this.frame);this.ready?.reject(new Error('Frame stream disconnected'))};client.on('disconnected',this.disconnected);
  }
  get fps(){const a=this.samples,elapsed=a.at(-1)-a[0];return a.length>1&&elapsed>0?Math.round((a.length-1)*10000/elapsed)/10:0}
  get diagnostics(){return {active:this.active,received:this.received||0,sequence:this.sequence,consumed:this.consumed,lastViewport:this.lastViewport,eventAgeMs:this.lastEventAt?Date.now()-this.lastEventAt:null}}
  fail(error){if(this.closed)return;this.failure=error;this.ready?.reject(error);this.waiter?.reject(error)}
  repairViewport(viewport){
    if(this.closed||!this.active||this.repairTask||Date.now()-(this.lastRepairAt||0)<500)return;
    if(!Number.isFinite(viewport.deviceWidth)||!Number.isFinite(viewport.deviceHeight)||viewport.deviceWidth<=0||viewport.deviceHeight<=0)return;
    this.lastRepairAt=Date.now();this.repairAttempts=(this.repairAttempts||0)+1;
    if(this.repairAttempts>8){this.fail(new Error('Capture viewport cannot be stabilized'));return}
    const epoch=this.epoch;
    this.repairTask=(async()=>{
      const window=await this.client.send('Browser.getWindowForTarget');if(this.closed||epoch!==this.epoch)return;
      const {width,height}=this.options,bounds={width:Math.round(window.bounds.width+width-viewport.deviceWidth),height:Math.round(window.bounds.height+height-viewport.deviceHeight)};
      if(bounds.width<width||bounds.height<height||bounds.width>width+256||bounds.height>height+256)throw new Error('Capture window correction exceeds bounds');
      await this.client.send('Browser.setWindowBounds',{windowId:window.windowId,bounds});if(this.closed||epoch!==this.epoch)return;
      await this.client.send('Emulation.setVisibleSize',{width,height});
    })().catch(error=>this.fail(error)).finally(()=>{this.repairTask=null});
  }
  next(){
    if(this.failure)return Promise.reject(this.failure);
    if(!this.active||this.closed)return Promise.resolve(this.frame);
    if(this.sequence>this.consumed){this.consumed=this.sequence;return Promise.resolve(this.frame)}
    if(this.waiter)return this.waiter.promise;
    const waiter={};waiter.promise=new Promise((resolve,reject)=>{const timer=setTimeout(()=>waiter.resolve(this.frame),1500);const finish=()=>{clearTimeout(timer);if(this.waiter===waiter)this.waiter=null};waiter.resolve=frame=>{finish();resolve(frame)};waiter.reject=error=>{finish();reject(error)}});this.waiter=waiter;return waiter.promise;
  }
  async start(){
    if(this.closed)throw new Error('Frame stream is closed');if(this.active)return this.starting||this;
    this.active=true;const epoch=++this.epoch;this.samples=[];this.failure=null;this.repairAttempts=0;
    let timer;const ready={};ready.promise=new Promise((resolve,reject)=>{ready.resolve=resolve;ready.reject=reject;timer=setTimeout(()=>reject(new Error('Complete capture viewport not ready')),4000)});ready.promise.catch(()=>{});this.ready=ready;
    const valid=()=>{if(this.closed||epoch!==this.epoch)throw new Error('Frame stream cancelled')};
    const job=(async()=>{
      try{
        const {width,height,renderFps,displayFps}=this.options;
        await this.client.send('Emulation.setDeviceMetricsOverride',{width,height,screenWidth:width,screenHeight:height,deviceScaleFactor:1,mobile:false,dontSetVisibleSize:false});valid();
        await this.client.send('Emulation.setVisibleSize',{width,height});valid();
        await this.client.send('Page.startScreencast',{format:'jpeg',quality:[65,80,92].includes(this.options.captureQuality)?this.options.captureQuality:92,maxWidth:width,maxHeight:height,everyNthFrame:Math.max(1,Math.round(renderFps/Math.min(displayFps,renderFps)))});valid();
        await ready.promise;valid();return this;
      }catch(e){if(epoch===this.epoch){this.active=false;await this.client.send('Page.stopScreencast').catch(()=>{})}throw e}
      finally{clearTimeout(timer);if(this.ready===ready)this.ready=null}
    })();this.starting=job;
    try{return await job}finally{if(this.starting===job)this.starting=null}
  }
  async configure(playback){
    const changed=this.options.renderFps!==playback.renderFps||this.options.displayFps!==playback.displayFps;
    if(changed&&this.active)await this.stop();this.options={...this.options,renderFps:playback.renderFps,displayFps:playback.displayFps};
  }
  async stop(){
    const active=this.active;this.active=false;this.epoch++;this.samples=[];this.consumed=this.sequence;this.waiter?.resolve(this.frame);this.ready?.reject(new Error('Frame stream cancelled'));
    if(active&&this.client.connected)await this.client.send('Page.stopScreencast').catch(()=>{});
  }
  async close(){if(this.closed)return;this.closed=true;await this.stop();await this.repairTask;this.client.off('notification',this.listener);this.client.off('disconnected',this.disconnected);this.frame=null}
}
module.exports={FrameStream};
