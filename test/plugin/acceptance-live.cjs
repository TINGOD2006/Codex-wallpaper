const path=require('node:path'),assert=require('node:assert/strict');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const {resolvePaths}=require('../../src/companion/paths.cjs'),{connectCompanion}=require('../../src/companion/control-client.cjs');
(async()=>{
 const paths=resolvePaths(),manager=await connectCompanion({paths}),client=new Client({name:'wallpaper-acceptance',version:'1'}),transport=new StdioClientTransport({command:process.execPath,args:[path.join(paths.app,'plugins/codex-wallpaper-control/entrypoint.cjs')],stderr:'pipe'});
 try{await client.connect(transport);const tools=await client.listTools();assert.equal(tools.tools.length,6);assert.ok(tools.tools.find(t=>t.name==='wallpaper_status')._meta['openai/ui'].entrypoints.some(e=>e.type==='thread'));
  const state=(await client.callTool({name:'wallpaper_status',arguments:{}})).structuredContent,actual=(await manager.request('status')).state;assert.equal(state.instanceId,actual.instanceId);assert.equal(state.observed.applied,actual.observed.applied);
  const resource=await client.readResource({uri:'ui://codex-wallpaper/control'});assert.match(resource.contents[0].text,/Codex Wallpaper/);console.log(JSON.stringify({pluginTools:6,installedPluginConnected:true,statusMatchesManager:true,threadEntrypointDeclared:true,pluginView:null}));
 }finally{await client.close();await transport.close();manager.close()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
