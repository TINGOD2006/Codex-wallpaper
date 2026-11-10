const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {createAssetOrigin}=require('../../src/renderer/asset-origin.cjs'),{fingerprintEntry}=require('../../src/renderer/source-fingerprint.cjs');
async function setup(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cw-origin-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const directory=path.join(root,'source');await fs.mkdir(directory);await fs.writeFile(path.join(directory,'project.json'),'{"type":"video","file":"movie.mp4","title":"fixture"}');await fs.writeFile(path.join(directory,'movie.mp4'),'0123456789');const entry={id:'local:fixture',kind:'video',directory,mediaPath:path.join(directory,'movie.mp4')},paths={data:path.join(root,'data'),runtime:path.join(root,'runtime')};return {entry,paths}}
test('one origin isolates revocable leases, validates host/method and supports bounded Range',async t=>{
 const {entry,paths}=await setup(t),origin=createAssetOrigin({paths});await origin.start();t.after(()=>origin.close());const entryFingerprint=await fingerprintEntry(entry,{}),a=await origin.register(entry,{entryFingerprint}),b=await origin.register(entry,{entryFingerprint});
 assert.equal(a.sourceKey,b.sourceKey);assert.notEqual(a.assetBase,b.assetBase);
 const project=await (await fetch(b.assetBase+'project.json')).json(),range=await fetch(b.assetBase+project.file,{headers:{range:'bytes=2-4'}});assert.equal(range.status,206);assert.equal(await range.text(),'234');
 assert.equal((await fetch(b.assetBase+project.file,{headers:{range:'bytes=10-'}})).status,416);
 const foreignHost=await new Promise((resolve,reject)=>{const req=http.get(b.assetBase,{headers:{host:'evil.invalid'}},res=>{res.resume();resolve(res.statusCode)});req.on('error',reject)});assert.equal(foreignHost,403);assert.equal((await fetch(b.assetBase,{method:'POST'})).status,405);
 for(const name of ['%252e%252e/secret','%5csecret','engine.js%00','missing'])assert.equal((await fetch(b.assetBase+name)).status,404);
 await a.revoke();assert.equal((await fetch(a.assetBase+'project.json')).status,404);assert.equal((await fetch(b.assetBase+'project.json')).status,200);
 const config=await (await fetch(b.assetBase+'render-config.json')).json();assert.equal(config.sourceKey,b.sourceKey);assert.equal(config.cachePolicy.enabled,false);
 const control=origin.openControl();assert.equal((await fetch(control)).status,200);for(const name of ['cache-policy.js','cache-index.js','cache-adapter.js'])assert.equal((await fetch(new URL(name,control))).status,200);
});
test('preferred origin is reused; an occupied port stays alive and produces cold origin',async t=>{
 const {paths}=await setup(t),first=createAssetOrigin({paths}),a=await first.start();await first.close();const second=createAssetOrigin({paths}),b=await second.start();assert.equal(b.origin,a.origin);await second.close();
 const foreign=http.createServer((req,res)=>res.end('foreign'));await new Promise(r=>foreign.listen(Number(new URL(a.origin).port),'127.0.0.1',r));t.after(()=>new Promise(r=>foreign.close(r)));
 const third=createAssetOrigin({paths});t.after(()=>third.close());const c=await third.start();assert.notEqual(c.origin,a.origin);assert.equal(c.coldOrigin,true);assert.equal(await (await fetch(a.origin)).text(),'foreign');
});
test('a media link swapped outside the registered source is not served',async t=>{
 const {paths,entry}=await setup(t),origin=createAssetOrigin({paths});await origin.start();t.after(()=>origin.close());const registered=await origin.register(entry,{entryFingerprint:await fingerprintEntry(entry,{})});const outside=path.join(paths.data,'outside.mp4');await fs.writeFile(outside,'0123456789');await fs.unlink(entry.mediaPath);await fs.symlink(outside,entry.mediaPath);assert.equal((await fetch(registered.assetBase+'media.mp4')).status,404);
});
