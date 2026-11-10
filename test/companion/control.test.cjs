const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {startControlServer}=require('../../src/companion/control-server.cjs'),{resolvePaths}=require('../../src/companion/paths.cjs');

test('parallel bootstrap never publishes a control descriptor before private access is ready',async()=>{
 const paths=resolvePaths({localAppData:await fs.mkdtemp(path.join(os.tmpdir(),'cw-protection-'))});let release;
 const protectedAccess=new Promise(resolve=>release=resolve),starting=startControlServer({paths,supervisor:{instanceId:'fixture',snapshot:()=>({})},appearance:{},protect:()=>protectedAccess});
 try{await new Promise(resolve=>setTimeout(resolve,25));await assert.rejects(fs.access(path.join(paths.runtime,'manager.json')),{code:'ENOENT'})}finally{release()}
 const server=await starting;try{assert.equal(JSON.parse(await fs.readFile(path.join(paths.runtime,'manager.json'),'utf8')).instanceId,'fixture')}finally{await server.close()}
});
test('control requires authentication, rejects foreign origins and executes replayed requests once',async()=>{
 const paths=resolvePaths({localAppData:await fs.mkdtemp(path.join(os.tmpdir(),'cw-control-'))});let count=0;
 const supervisor={instanceId:'fixture',snapshot:()=>({phase:'idle',observed:{applied:false}}),setEnabled:async()=>{count++}};
 const server=await startControlServer({paths,supervisor,appearance:{view:async()=>({})},protect:async()=>{}});
 try{
  const call=(body,headers={})=>fetch(server.address+'/api/command',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  const command={requestId:'11111111-1111-4111-8111-111111111111-1',action:'set-enabled',payload:{enabled:true}},auth={Authorization:'Bearer '+server.descriptor.token};
  assert.equal((await call(command)).status,401);assert.equal((await call(command,{...auth,Origin:'https://evil.example'})).status,403);
  assert.equal((await call(command,auth)).status,200);assert.equal((await call(command,auth)).status,200);assert.equal(count,1);
  assert.equal((await call({...command,payload:{enabled:false}},auth)).status,409);
  assert.equal((await call({...command,requestId:command.requestId.slice(0,-1)+'3'},auth)).status,200);
  assert.equal((await call({...command,requestId:command.requestId.slice(0,-1)+'2'},auth)).status,200);assert.equal(count,3);
 }finally{await server.close()}
});
test('bootstrap is single-use and diagnostics never export private error text or credentials',async()=>{
 const paths=resolvePaths({localAppData:await fs.mkdtemp(path.join(os.tmpdir(),'cw-bootstrap-'))});
 const state={instanceId:'fixture',phase:'error',desired:{enabled:true},observed:{applied:false},error:{code:'RENDERER_FAILED',stage:'render',message:'C:/Users/private/chat-content token=SECRET'}};
 const server=await startControlServer({paths,supervisor:{instanceId:'fixture',snapshot:()=>state,captionHost:()=>({pid:42,startTime:'10',appPath:'C:/Official/ChatGPT.exe',appVersion:'fixture'})},appearance:{},protect:async()=>{}});
 try{
  const {connectCompanion}=require('../../src/companion/control-client.cjs');
  await assert.rejects(connectCompanion({paths,verifyProcess:async()=>false}),/identity/);
  const client=await connectCompanion({paths,verifyProcess:async()=>true});assert.equal((await client.request('status')).state.phase,'error');
  const panelLink=(await client.request('panel-link')).result.url;assert.equal(new URL(panelLink).origin,server.address);assert.equal(panelLink.includes(server.descriptor.token),false);
  const sidebarLink=(await client.request('sidebar-link')).result.url;assert.equal(new URL(sidebarLink).pathname,'/sidebar');assert.equal(sidebarLink.includes(server.descriptor.token),false);assert.equal((await client.request('caption-host')).result.host.pid,42);await assert.rejects(client.request('caption-host',{pid:1}));client.close();
  const nonce=new URL(panelLink).hash.slice(1),redeem=()=>fetch(server.address+'/api/session',{method:'POST',headers:{Origin:server.address,'Content-Type':'application/json'},body:JSON.stringify({nonce})});
  const response=await redeem();assert.equal(response.status,200);assert.equal((await redeem()).status,401);
  const cookie=response.headers.get('set-cookie').split(';')[0];assert.equal((await fetch(server.address+'/api/status',{headers:{Cookie:cookie}})).status,200);
  const {exportDiagnostics}=require('../../src/companion/diagnostics.cjs'),result=await exportDiagnostics({state,paths});const text=await fs.readFile(path.join(paths.logs,result.fileName),'utf8');
  assert.equal(text.includes('private'),false);assert.equal(text.includes('SECRET'),false);assert.equal(text.includes(server.descriptor.token),false);
 }finally{await server.close()}
 await assert.rejects(fs.access(path.join(paths.runtime,'manager.json')));
});
