const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {fixture}=require('./fixtures.cjs');
const {createPayloadManifest,verifyPayload,manifestHash}=require('../../src/startup-hook/manifest.cjs');
test('manifest is deterministic and verifies all bytes, not only filenames',async t=>{
 const root=await fixture(t);await fs.writeFile(path.join(root,'a.cjs'),'aaa');await fs.writeFile(path.join(root,'b.cjs'),'bbb');
 const manifest=await createPayloadManifest({root,files:['b.cjs','a.cjs']});assert.deepEqual(manifest,await createPayloadManifest({root,files:['a.cjs','b.cjs']}));
 const expectedHash=manifestHash(manifest);assert.equal(await verifyPayload({root,manifest,expectedHash}),true);
 await fs.writeFile(path.join(root,'a.cjs'),'AAA');await assert.rejects(verifyPayload({root,manifest,expectedHash}),{code:'HOOK_HASH_MISMATCH'});
 await fs.unlink(path.join(root,'a.cjs'));await assert.rejects(verifyPayload({root,manifest,expectedHash}),{code:'HOOK_PAYLOAD_MISSING'});
});
test('manifest rejects wrong identity, duplicate paths, escape, hardlinks and junctions',async t=>{
 const root=await fixture(t);await fs.writeFile(path.join(root,'a.cjs'),'a');
 const manifest=await createPayloadManifest({root,files:['a.cjs']});await assert.rejects(verifyPayload({root,manifest,expectedHash:'0'.repeat(64)}),{code:'HOOK_HASH_MISMATCH'});
 for(const files of [['a.cjs','a.cjs'],['../a.cjs'],['/a.cjs'],['a.cjs:stream'],['a.cjs','A.cjs']])await assert.rejects(createPayloadManifest({root,files}));
 await fs.link(path.join(root,'a.cjs'),path.join(root,'linked.cjs'));await assert.rejects(createPayloadManifest({root,files:['linked.cjs']}));
 const external=await fixture(t);await fs.writeFile(path.join(external,'file.cjs'),'x');await fs.symlink(external,path.join(root,'link'),process.platform==='win32'?'junction':'dir');await assert.rejects(createPayloadManifest({root,files:['link/file.cjs']}));
});
