const {spawn}=require('node:child_process');
const path=require('node:path');
const {createJsonLines}=require('./json-lines.cjs');
class WindowMonitor {
  visible=false;
  constructor(identityPath,{spawnProcess=spawn,clock={setTimeout,clearTimeout},now=Date.now,settleMs=500}={}){
    this.clock=clock;this.now=now;this.settleMs=settleMs;this.visibleSince=null;this.closed=false;this.timer=null;this.failures=0;
    const start=()=>{
      if(this.closed)return;
      const child=spawnProcess(process.env.MIKU_PWSH||'pwsh',['-NoProfile','-File',path.resolve(__dirname,'../scripts/window-state.ps1'),'-IdentityPath',identityPath],{windowsHide:true,stdio:['ignore','pipe','ignore']});this.child=child;
      const failed=()=>{if(this.closed||this.child!==child||this.timer!==null)return;this.visible=false;this.visibleSince=null;this.child=null;child.kill();this.timer=clock.setTimeout(()=>{this.timer=null;start()},Math.min(30000,250*2**Math.min(this.failures++,7)))};
      const receive=createJsonLines({onOverflow:failed,onValue:state=>{if(this.closed||this.child!==child)return;if(typeof state?.visible==='boolean'){if(state.visible&&!this.visible)this.visibleSince=this.now();if(!state.visible)this.visibleSince=null;this.visible=state.visible;this.failures=0}}});
      child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{if(!this.closed&&this.child===child)receive(chunk)});
      child.on('error',failed);child.on('exit',failed);
    };start();
  }
  get stableVisible(){return this.visible&&this.visibleSince!==null&&this.now()-this.visibleSince>=this.settleMs}
  close(){this.closed=true;this.clock.clearTimeout(this.timer);this.timer=null;const child=this.child;this.child=null;child?.kill();}
}
module.exports={WindowMonitor};
