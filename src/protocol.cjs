const {EventEmitter}=require('node:events');
function validateTarget(target,identity) {
  if (!target || target.type!=='page' || target.url!=='app://-/index.html' || !/^[\w-]+$/.test(target.id||'')) throw new Error('Not a main desktop application target');
  const url=new URL(target.webSocketDebuggerUrl);
  if(url.protocol!=='ws:' || url.hostname!=='127.0.0.1' || Number(url.port)!==identity.port || url.username || url.password || url.search || url.hash || url.pathname!==`/devtools/page/${target.id}`)throw new Error('Untrusted debugging endpoint');
  return target;
}
function selectTarget(targets,identity) {
  if(!Array.isArray(targets))throw new Error('Invalid target list');
  const main=targets.filter(t=>t.type==='page'&&t.url==='app://-/index.html');
  if(main.length!==1)throw new Error('Expected one main desktop page; target is absent or ambiguous');
  return validateTarget(main[0],identity);
}
class Protocol extends EventEmitter {
  #pending=new Map(); #sequence=0; #closed=false;
  constructor(socket,{timeoutMs=10000}={}) {
    super();this.socket=socket;this.timeoutMs=timeoutMs;
    socket.addEventListener('message',event=>{
      let message;
      try{message=JSON.parse(event.data);}catch{return;}
      if(!message.id){if(message.method)this.emit('notification',message);return;}
      const pending=this.#pending.get(message.id);if(!pending)return;
      this.#pending.delete(message.id);clearTimeout(pending.timer);
      message.error?pending.reject(new Error(message.error.message||'Protocol error')):pending.resolve(message.result||{});
    });
    const fail=()=>{
      if(this.#closed)return;this.#closed=true;
      for(const p of this.#pending.values()){clearTimeout(p.timer);p.reject(new Error('Debugging connection closed'));}
      this.#pending.clear();this.emit('disconnected');
    };
    socket.addEventListener('close',fail);socket.addEventListener('error',fail);
  }
  static async connect(target,identity,{timeoutMs=10000}={}) {
    validateTarget(target,identity);
    const socket=new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{
      const finish=(error)=>{clearTimeout(timer);socket.removeEventListener('open',opened);socket.removeEventListener('error',failed);socket.removeEventListener('close',failed);error?reject(error):resolve();};
      const opened=()=>finish();const failed=()=>finish(new Error('Cannot open debugging connection'));
      const timer=setTimeout(()=>{finish(new Error('Debugging connection timed out'));socket.close();},timeoutMs);
      socket.addEventListener('open',opened,{once:true});socket.addEventListener('error',failed,{once:true});socket.addEventListener('close',failed,{once:true});
    });
    return new Protocol(socket,{timeoutMs});
  }
  get pendingCount(){return this.#pending.size;}
  get connected(){return !this.#closed&&this.socket.readyState===1;}
  async send(method,params={}) {
    if(!this.connected)throw new Error('Debugging connection closed');
    const id=++this.#sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.#pending.delete(id);reject(new Error(`${method} timed out`));},this.timeoutMs);
      this.#pending.set(id,{resolve,reject,timer});
      try{this.socket.send(JSON.stringify({id,method,params}));}catch(error){clearTimeout(timer);this.#pending.delete(id);reject(error);}
    });
  }
  async evaluate(expression) {
    const result=await this.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(result.exceptionDetails)throw new Error('Theme evaluation failed');
    return result.result?.value;
  }
  close(){this.socket.close();}
}
module.exports={Protocol,validateTarget,selectTarget};
