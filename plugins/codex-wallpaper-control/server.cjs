const fs=require('node:fs/promises'),path=require('node:path');
const {McpServer}=require('@modelcontextprotocol/sdk/server/mcp.js'),{StdioServerTransport}=require('@modelcontextprotocol/sdk/server/stdio.js'),{z}=require('zod');
const {createPluginBridge}=require('./bridge.cjs');
const URI='ui://codex-wallpaper/control';
function createPluginServer({bridge=createPluginBridge(),html}={}){
 const server=new McpServer({name:'codex-wallpaper-control',version:'0.7.0'},{maxToolInputElements:10000});
 const result=state=>({content:[{type:'text',text:state.phase==='offline'?(state.error?.message||'獨立桌布管理器目前離線。'):JSON.stringify({phase:state.phase,applied:state.observed.applied,error:state.error?.code||null})}],structuredContent:state});
 const wrap=fn=>async args=>{try{return result(await fn(args))}catch(e){const state=await bridge.status();return {...result(state),isError:true,content:[{type:'text',text:e.code==='RUNTIME_MISSING'?'請先安裝或開啟獨立桌布管理器。':'操作失敗，請查看獨立管理器的錯誤狀態。'}]}}};
 server.registerTool('wallpaper_status',{title:'Wallpaper 控制面板',description:'Inspect current wallpaper state, compatibility and visible errors.',inputSchema:z.object({}).strict(),annotations:{readOnlyHint:true,openWorldHint:false},_meta:{ui:{resourceUri:URI},'openai/ui':{entrypoints:[{type:'global'},{type:'thread'}]}}},wrap(()=>bridge.status()));
 server.registerTool('wallpaper_open_manager',{description:'Show the independent Windows wallpaper manager.',inputSchema:z.object({}).strict(),annotations:{openWorldHint:false}},wrap(()=>bridge.openManager()));
 server.registerTool('wallpaper_set_enabled',{description:'Set wallpaper preference and return confirmed actual state.',inputSchema:z.object({enabled:z.boolean()}).strict(),annotations:{openWorldHint:false}},wrap(({enabled})=>bridge.setEnabled(enabled)));
 const section=z.record(z.string(),z.unknown()),performance=z.object({rendererMode:z.enum(['auto','pool','isolated']).optional(),resolutionMode:z.enum(['window','manual']).optional(),qualityMode:z.literal('fixed').optional(),cacheEnabled:z.boolean().optional(),powerSaving:z.boolean().optional()}).strict(),patch=z.object({enabled:z.boolean().optional(),wallpaper:section.optional(),reading:section.optional(),materials:section.optional(),colors:section.optional(),playback:section.optional(),performance:performance.optional()}).strict();
 server.registerTool('wallpaper_set_settings',{description:'Update appearance settings using the companion strict schema.',inputSchema:z.object({patch}).strict(),annotations:{openWorldHint:false}},wrap(({patch})=>bridge.setSettings(patch)));
 server.registerTool('wallpaper_reconnect',{description:'Re-detect host and reconnect without forcing it to close.',inputSchema:z.object({}).strict(),annotations:{openWorldHint:false}},wrap(()=>bridge.reconnect()));
 server.registerTool('wallpaper_export_diagnostics',{description:'Export a sanitized diagnostic report without chats, credentials or wallpaper media.',inputSchema:z.object({}).strict(),annotations:{openWorldHint:false}},async()=>{try{const reply=await bridge.exportDiagnostics();return {...result(reply.state),content:[{type:'text',text:'診斷已保存：'+reply.result.fileName}]}}catch{return {...result(await bridge.status()),isError:true}}});
 server.registerResource('wallpaper-control',URI,{mimeType:'text/html;profile=mcp-app'},async()=>({contents:[{uri:URI,mimeType:'text/html;profile=mcp-app',text:html||await fs.readFile(path.join(__dirname,'dist/control.html'),'utf8'),_meta:{ui:{csp:{connectDomains:[],resourceDomains:[]}}}}]}));
 return server;
}
if(require.main===module){const bridge=createPluginBridge(),server=createPluginServer({bridge});server.connect(new StdioServerTransport()).catch(()=>{process.stderr.write('Wallpaper MCP startup failed\n');process.exitCode=1});process.once('SIGTERM',()=>{bridge.close();server.close()})}
module.exports={createPluginServer,URI};
