const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {atomicJson,readJson}=require('./config.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function sendCommand(root,action,{timeoutMs=30000,pollMs=100}={}) {
  if(!['apply','disable'].includes(action))throw new Error('Unsupported theme command');
  const identity=await readJson(path.join(root,'session.json'));
  const id=randomUUID();const requestPath=path.join(root,'commands',`${id}.json`);
  const resultPath=path.join(root,'results',`${id}.json`);
  const expiresAt=Date.now()+timeoutMs;
  await atomicJson(requestPath,{id,sessionId:identity.sessionId,action,expiresAt});
  try {
    while(Date.now()<expiresAt) {
      try {
        const response=await readJson(resultPath);
        if(response.id!==id||response.sessionId!==identity.sessionId)throw new Error('Command result identity mismatch');
        await fs.unlink(resultPath);
        if(response.error)throw new Error(response.error);
        return response.result;
      } catch(error){if(error.code!=='ENOENT')throw error;}
      await delay(pollMs);
    }
    throw new Error('Theme command timed out; result is unconfirmed. Check Status before retrying.');
  } finally {await fs.unlink(requestPath).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function consumeCommands(root,sessionId,handler) {
  const directory=path.join(root,'commands');await fs.mkdir(directory,{recursive:true});
  for(const name of (await fs.readdir(directory)).filter(name=>/^[\w-]{1,100}\.json$/.test(name)).sort()) {
    const original=path.join(directory,name),claimed=`${original}.processing`;
    try{await fs.rename(original,claimed);}catch(error){if(error.code==='ENOENT')continue;throw error;}
    const id=name.slice(0,-5);
    const response={id,sessionId};
    try {
      const request=await readJson(claimed);
      if(request.id!==id||request.sessionId!==sessionId)throw new Error('Stale or invalid theme session');
      if(request.expiresAt!==undefined&&(!Number.isFinite(request.expiresAt)||request.expiresAt<Date.now()))throw new Error('Theme command expired');
      if(!['apply','disable'].includes(request.action))throw new Error('Unsupported theme command');
      response.result=await handler(request.action);
    } catch(error){response.error=error.message;}
    await atomicJson(path.join(root,'results',`${id}.json`),response);
    await fs.unlink(claimed);
  }
}
module.exports={sendCommand,consumeCommands,delay};
