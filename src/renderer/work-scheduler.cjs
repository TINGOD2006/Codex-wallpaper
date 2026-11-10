const {renderError,checkAbort}=require('./errors.cjs');
function createWorkScheduler(){
 let closed=false,closing,active=null,sequence=0;const queue=[];
 function remove(job){const at=queue.indexOf(job);if(at>=0)queue.splice(at,1)}
 function pump(){if(closed||active||!queue.length)return;queue.sort((a,b)=>Number(b.purpose==='playback')-Number(a.purpose==='playback')||a.sequence-b.sequence);const job=queue.shift();active=job;
  job.done=(async()=>{try{checkAbort(job.signal);job.resolve(await job.work({signal:job.signal}))}catch(error){job.reject(error)}finally{job.external?.removeEventListener('abort',job.cancel);if(active===job)active=null;queueMicrotask(pump)}})();
 }
 function run(work,{purpose='playback',signal}={}){if(closed)return Promise.reject(renderError('POOL_CLOSED'));if(!['playback','poster'].includes(purpose)||typeof work!=='function')return Promise.reject(new Error('Invalid render work'));try{checkAbort(signal)}catch(error){return Promise.reject(error)}
  const controller=new AbortController(),job={work,purpose,external:signal,signal:signal?AbortSignal.any([signal,controller.signal]):controller.signal,controller,sequence:sequence++};
  const promise=new Promise((resolve,reject)=>{job.resolve=resolve;job.reject=reject});job.cancel=()=>{if(active===job)return;remove(job);job.reject(job.signal.reason||new DOMException('Cancelled','AbortError'))};signal?.addEventListener('abort',job.cancel,{once:true});queue.push(job);queueMicrotask(pump);return promise;
 }
 return {run,snapshot(){return {active:active?.purpose||null,queued:queue.length}},close(){if(closing)return closing;closed=true;closing=(async()=>{for(const job of queue.splice(0)){job.external?.removeEventListener('abort',job.cancel);job.controller.abort(renderError('POOL_CLOSED'));job.reject(renderError('POOL_CLOSED'))}if(active){const job=active;job.controller.abort(renderError('POOL_CLOSED'));await job.done}})();return closing}};
}
module.exports={createWorkScheduler};
