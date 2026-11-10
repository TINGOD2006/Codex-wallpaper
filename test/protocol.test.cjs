const {test} = require('node:test');
const assert = require('node:assert/strict');
const {Protocol,validateTarget,selectTarget} = require('../src/protocol.cjs');
const target={id:'abc',type:'page',url:'app://-/index.html',webSocketDebuggerUrl:'ws://127.0.0.1:4567/devtools/page/abc'};
test('only accepts the managed loopback port and main application page',()=>{
  assert.equal(validateTarget(target,{port:4567}),target);
  for(const patch of [{url:'https://chatgpt.com/'},{type:'iframe'},{webSocketDebuggerUrl:'ws://example.com:4567/devtools/page/abc'},{webSocketDebuggerUrl:'ws://127.0.0.1:4568/devtools/page/abc'},{webSocketDebuggerUrl:'ws://user@127.0.0.1:4567/devtools/page/abc'},{webSocketDebuggerUrl:'ws://127.0.0.1:4567/devtools/page/other'}])assert.throws(()=>validateTarget({...target,...patch},{port:4567}));
  assert.throws(()=>selectTarget([target,target],{port:4567}),/one|ambiguous/i);
});
class Socket extends EventTarget {
  readyState=1; messages=[];
  send(text){this.messages.push(JSON.parse(text));}
  close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
  reply(value){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(value)}));}
}
test('a timed-out request is rejected and removed',async()=>{
  const socket=new Socket(),client=new Protocol(socket,{timeoutMs:15});
  await assert.rejects(client.send('CSS.enable'),/timed out/);
  assert.equal(client.pendingCount,0);client.close();
});
test('closing the connection rejects pending operations immediately',async()=>{
  const socket=new Socket(),client=new Protocol(socket,{timeoutMs:1000});
  const promise=client.send('CSS.enable');socket.close();
  await assert.rejects(promise,/closed/);assert.equal(client.pendingCount,0);
  await assert.rejects(client.send('CSS.enable'),/closed/);
});
test('successful replies and protocol errors settle the correct request',async()=>{
  const socket=new Socket(),client=new Protocol(socket);
  const first=client.send('CSS.enable'),second=client.send('CSS.createStyleSheet');
  socket.reply({id:socket.messages[1].id,result:{styleSheetId:'a'}});
  socket.reply({id:socket.messages[0].id,error:{message:'no document'}});
  assert.deepEqual(await second,{styleSheetId:'a'});await assert.rejects(first,/no document/);
  assert.equal(client.pendingCount,0);client.close();
});
