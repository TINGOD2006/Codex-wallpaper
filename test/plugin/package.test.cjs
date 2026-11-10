const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const root=path.resolve('plugins/codex-wallpaper-control');
test('portable and compatibility manifests share identity and use a portable local MCP command',async()=>{
 const read=async name=>JSON.parse(await fs.readFile(path.join(root,name),'utf8'));
 const portable=await read('plugin.json'),compatibility=await read('.codex-plugin/plugin.json'),mcp=await read('mcp.json');
 assert.equal(portable.$schema,'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');assert.equal(portable.name,compatibility.name);assert.equal(portable.version,compatibility.version);
 assert.ok(portable.extensions['com.openai'].interface.shortDescription.length<=30);
 assert.equal(mcp.mcpServers.wallpaper.command,'node');assert.deepEqual(mcp.mcpServers.wallpaper.args,['${PLUGIN_ROOT}/entrypoint.cjs']);
 assert.equal(JSON.stringify(mcp).includes('token'),false);
});
test('compiled app has exactly one script and never expands replacement markers inside SDK code',async()=>{
 const html=await fs.readFile('dist/plugin/codex-wallpaper-control/dist/control.html','utf8');
 assert.equal(html.includes('PLUGIN_SCRIPT'),false);assert.equal((html.match(/<\/body>/g)||[]).length,1);assert.equal((html.match(/<script type="module">/g)||[]).length,1);
});
