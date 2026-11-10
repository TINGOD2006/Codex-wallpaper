const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {fencedFile,createSceneServer}=require('../src/scene-server.cjs');
test('scene server confines resources to the selected wallpaper and rejects untrusted hosts and writes',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'codex-scene-'));
  await fs.writeFile(path.join(root,'project.json'),JSON.stringify({type:'scene',file:'scene.json',title:'fixture'}));await fs.writeFile(path.join(root,'scene.pkg'),'fixture');
  const server=await createSceneServer({wallpaperDirectory:root});
  try{
    assert.equal((await(await fetch(server.url+'project.json')).json()).file,'scene.pkg');
    assert.equal(await(await fetch(server.url+'scene.pkg')).text(),'fixture');
    assert.equal((await fetch(server.url+'scene.pkg',{method:'POST'})).status,405);
    const rejectedHost=await new Promise((resolve,reject)=>{const req=require('node:http').get(server.url+'scene.pkg',{headers:{Host:'attacker.invalid'}},res=>{res.resume();resolve(res.statusCode)});req.on('error',reject)});
    assert.equal(rejectedHost,403);
    assert.equal((await fetch(server.url.replace(/\/[^/]+\/$/,'/wrong/')+'scene.pkg')).status,404);
    for(const name of ['../secret','/etc/passwd','..\\secret','a/../../secret'])await assert.rejects(()=>fencedFile(root,name));
    assert.equal((await fetch(server.url+'engine.js',{method:'HEAD'})).headers.get('content-type'),'text/javascript');
  }finally{await server.close();await fs.unlink(path.join(root,'project.json'));await fs.unlink(path.join(root,'scene.pkg'));await fs.rmdir(root)}
});
