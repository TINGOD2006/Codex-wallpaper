const fs=require('node:fs/promises'),path=require('node:path');
const {createHash}=require('node:crypto'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile);

function createThumbnailQueue(){
  const waiting=[],active=new Set();let closed=false,closing;
  function pump(){
    while(!closed&&active.size<2&&waiting.length){
      const job=waiting.shift();active.add(job);
      job.done=Promise.resolve().then(()=>{job.abort.signal.throwIfAborted();return job.work(job.abort.signal)}).then(job.resolve,job.reject).finally(()=>{active.delete(job);pump()});
    }
  }
  return {
    enqueue(work){
      if(closed)return Promise.resolve(null);
      const promise=new Promise((resolve,reject)=>{waiting.push({work,resolve,reject,abort:new AbortController()});pump()});
      return promise;
    },
    close(){
      if(closing)return closing;closed=true;
      for(const job of waiting.splice(0))job.resolve(null);
      for(const job of active)job.abort.abort();
      closing=Promise.allSettled([...active].map(job=>job.done));return closing;
    }
  };
}

function createThumbnailer({dataRoot,convert,queue=createThumbnailQueue()}){
  const pending=new Map();
  async function make(file,signal){
    const stat=await fs.stat(file);if(stat.size>8*1024*1024)return null;signal.throwIfAborted();
    const key=createHash('sha256').update(file+stat.size+stat.mtimeMs).digest('hex'),output=path.join(dataRoot,'thumbnails',key+'.jpg');
    await fs.mkdir(path.dirname(output),{recursive:true});signal.throwIfAborted();
    try{await fs.access(output)}catch{
      signal.throwIfAborted();
      if(convert)await convert(file,output,{signal});
      else await run(process.env.MIKU_PWSH||'pwsh',['-NoProfile','-File',path.resolve(__dirname,'../../scripts/wallpaper-thumbnail.ps1'),'-ImagePath',file,'-OutputPath',output],{windowsHide:true,timeout:15000,maxBuffer:16384,signal});
    }
    signal.throwIfAborted();const bytes=await fs.readFile(output);if(bytes.length>2*1024*1024)return null;
    return 'data:image/jpeg;base64,'+bytes.toString('base64');
  }
  const thumbnail=file=>{
    if(!file)return Promise.resolve(null);if(pending.has(file))return pending.get(file);
    const job=queue.enqueue(signal=>make(file,signal)).catch(()=>null).finally(()=>pending.delete(file));pending.set(file,job);return job;
  };
  thumbnail.close=()=>queue.close();return thumbnail;
}

function createPosterCache({dataRoot,renderPoster,queue=createThumbnailQueue(),runtimeRoot}){
  const pending=new Map();
  const poster=entry=>{
    const key=entry.mediaPath;if(pending.has(key))return pending.get(key);
    const task=queue.enqueue(async signal=>{
      const stat=await fs.stat(key);signal.throwIfAborted();
      const id=createHash('sha256').update(key+stat.size+stat.mtimeMs).digest('hex'),out=path.join(dataRoot,'thumbnails',id+'-poster.jpg');
      try{return 'data:image/jpeg;base64,'+(await fs.readFile(out)).toString('base64')}catch{}
      signal.throwIfAborted();const uri=await (renderPoster||require('./renderer.cjs').renderPoster)(entry,{signal,runtimeRoot});signal.throwIfAborted();
      await fs.mkdir(path.dirname(out),{recursive:true});signal.throwIfAborted();await fs.writeFile(out,Buffer.from(uri.split(',')[1],'base64'));return uri;
    }).catch(()=>null).finally(()=>pending.delete(key));pending.set(key,task);return task;
  };
  poster.close=()=>queue.close();return poster;
}
module.exports={createThumbnailer,createPosterCache,createThumbnailQueue};
