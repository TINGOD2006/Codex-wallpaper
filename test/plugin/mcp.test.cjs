const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js'),{InMemoryTransport}=require('@modelcontextprotocol/sdk/inMemory.js');
const {createPluginServer}=require('../../plugins/codex-wallpaper-control/server.cjs');
test('MCP protocol exposes six strict tools and a fixed resource without starting the offline manager',async()=>{
 const local=await fs.mkdtemp(path.join(os.tmpdir(),'cw-mcp-')),client=new Client({name:'test',version:'1'}),transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('plugins/codex-wallpaper-control/server.cjs')],env:{...process.env,CODEX_WALLPAPER_ROOT:path.join(local,'CodexWallpaper')},stderr:'pipe'});
 try{
  await client.connect(transport);const listed=await client.listTools();assert.equal(listed.tools.length,6);assert.ok(listed.tools.every(t=>t.inputSchema.additionalProperties===false));
  assert.deepEqual(listed.tools.find(t=>t.name==='wallpaper_status')._meta['openai/ui'].entrypoints,[{type:'global'},{type:'thread'}]);
  const result=await client.callTool({name:'wallpaper_status',arguments:{}});assert.equal(result.structuredContent.phase,'offline');assert.equal(result.structuredContent.observed.applied,false);
  const bad=await client.callTool({name:'wallpaper_set_enabled',arguments:{enabled:true,pid:123}});assert.equal(bad.isError,true);
  await assert.rejects(fs.access(path.join(local,'CodexWallpaper/runtime/manager.json')));
 }finally{await client.close();await transport.close()}
});
test('app resource and safe diagnostics results remain usable over standard MCP',async()=>{
 const state={phase:'idle',observed:{applied:false},desired:{enabled:true}},bridge={status:async()=>state,exportDiagnostics:async()=>({state,result:{fileName:'diagnostics-fixture.json'}})};
 const server=createPluginServer({bridge,html:'<!doctype html><h1>Fixture</h1>'}),client=new Client({name:'test',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
 try{await server.connect(b);await client.connect(a);const resource=await client.readResource({uri:'ui://codex-wallpaper/control'});assert.match(resource.contents[0].text,/Fixture/);const result=await client.callTool({name:'wallpaper_export_diagnostics',arguments:{}});assert.match(result.content[0].text,/diagnostics-fixture/);assert.equal(JSON.stringify(result).includes('Bearer'),false)}finally{await client.close();await server.close()}
});
test('built plugin runs outside the source tree without node_modules or manager installation',async()=>{
 const local=await fs.mkdtemp(path.join(os.tmpdir(),'cw-portable-')),plugin=path.join(local,'plugin');await fs.cp(path.resolve('dist/plugin/codex-wallpaper-control'),plugin,{recursive:true});
 const client=new Client({name:'test',version:'1'}),transport=new StdioClientTransport({command:process.execPath,args:[path.join(plugin,'entrypoint.cjs')],env:{...process.env,CODEX_WALLPAPER_ROOT:path.join(local,'CodexWallpaper')},stderr:'pipe'});
 try{await client.connect(transport);assert.equal((await client.callTool({name:'wallpaper_status',arguments:{}})).structuredContent.phase,'offline');const resource=await client.readResource({uri:'ui://codex-wallpaper/control'});assert.ok(resource.contents[0].text.includes('Codex Wallpaper'))}finally{await client.close();await transport.close()}
});
test('performance settings keep the six-tool API and reject unknown enums before the bridge',async()=>{
 let calls=0;const state={phase:'idle',observed:{applied:false},desired:{enabled:true}},bridge={status:async()=>state,setSettings:async patch=>{calls++;assert.equal(patch.performance.rendererMode,'pool');return state}},server=createPluginServer({bridge,html:'fixture'}),client=new Client({name:'test',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
 try{await server.connect(b);await client.connect(a);const good=await client.callTool({name:'wallpaper_set_settings',arguments:{patch:{performance:{rendererMode:'pool',qualityMode:'fixed',powerSaving:true}}}});assert.notEqual(good.isError,true);for(const performance of [{rendererMode:'unknown'},{cacheEnabled:'true'},{extra:true},{qualityMode:'adaptive'},{powerSaving:'yes'}]){const bad=await client.callTool({name:'wallpaper_set_settings',arguments:{patch:{performance}}});assert.equal(bad.isError,true)}assert.equal(calls,1);assert.equal((await client.listTools()).tools.length,6)}finally{await client.close();await server.close()}
});
