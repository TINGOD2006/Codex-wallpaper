const {spawn}=require('node:child_process');
const {createRecovery}=require('../renderer/recovery.cjs');
const {createJsonLines}=require('../json-lines.cjs');

// Owns only the caption helper, never the native host or renderer.
function createCaptionWorker({executable,args,stderr,update,report=()=>{},isExpectedStop=async()=>false,spawnProcess=spawn,clock={now:Date.now,setTimeout,clearTimeout,setInterval,clearInterval}}){
 const recovery=createRecovery({now:clock.now});
 const terminating=new WeakSet();
 let child=null,closed=false,restartTimer=null,watchdog=null,lastBeat=0,epoch=0;
 const cancelRestart=()=>{clock.clearTimeout(restartTimer);restartTimer=null};
 function terminate(mine){if(terminating.has(mine))return;terminating.add(mine);try{mine.kill()}catch{update({state:'error',error:'RUNTIME_MISSING'});report({code:'CAPTION_STOP_FAILED'})}}
 async function failed(mine,mineEpoch){
  if(closed||child!==mine||epoch!==mineEpoch)return;
  // Do not create a replacement before the old process has actually exited.
  if(mine.pid&&mine.exitCode===null&&mine.signalCode===null){terminate(mine);return}
  child=null;clock.clearInterval(watchdog);watchdog=null;
  const expected=await isExpectedStop().catch(()=>false);
  if(closed||epoch!==mineEpoch)return;
  if(expected){update({state:'off'});return}
  update({state:'error',error:'RUNTIME_MISSING'});
  if(!recovery.allowRestart()){report({code:'CAPTION_RETRY_LIMIT'});return}
  report({code:'CAPTION_RESTART',attempt:recovery.snapshot().attempts});
  restartTimer=clock.setTimeout(()=>{restartTimer=null;start()},recovery.delayMs());
 }
 function start(){
  if(closed||child||restartTimer!==null)return;
  const mineEpoch=++epoch;update({state:'starting'});lastBeat=clock.now();
  let mine;try{mine=spawnProcess(executable,args,{windowsHide:true,stdio:['ignore','pipe',stderr]})}catch{mine={exitCode:1,signalCode:null};child=mine;void failed(mine,mineEpoch);return}
  child=mine;let seenBeat=false,unresponsive=false;mine.stdout?.setEncoding('utf8');
  const receive=createJsonLines({onOverflow:()=>terminate(mine),onValue:entry=>{
   if(closed||child!==mine||epoch!==mineEpoch)return;
   if(!['starting','ready','hidden','unsupported','error','off'].includes(entry?.state))return;
   lastBeat=clock.now();seenBeat=true;update(entry);
  }});
  mine.stdout?.on('data',chunk=>{
   if(closed||child!==mine||epoch!==mineEpoch)return;
   receive(chunk);
  });
  mine.on('error',()=>void failed(mine,mineEpoch));
  mine.once('exit',()=>void failed(mine,mineEpoch));
  watchdog=clock.setInterval(()=>{if(!closed&&child===mine&&epoch===mineEpoch&&clock.now()-lastBeat>(seenBeat?30000:60000)){if(!unresponsive){unresponsive=true;update({state:'error',error:'RUNTIME_MISSING'});report({code:'CAPTION_UNRESPONSIVE'})}terminate(mine)}},5000);
  watchdog.unref?.();
 }
 return {start,get child(){return child},snapshot:()=>({running:!!child,recovery:recovery.snapshot()}),async retry(){if(closed||child||await isExpectedStop().catch(()=>false))return;cancelRestart();recovery.resetByUser();start()},stop(){closed=true;epoch++;cancelRestart();clock.clearInterval(watchdog);watchdog=null;return child}};
}
module.exports={createCaptionWorker};
