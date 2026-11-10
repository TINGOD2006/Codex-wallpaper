const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const {fixture}=require('./fixtures.cjs');
const {boot,guardHook,renderBootstrap}=require('../../src/startup-hook/bootstrap.cjs');
const {verifyPayloadSync}=require('../../src/startup-hook/host-broker.cjs');
const {createPayloadManifest,manifestHash}=require('../../src/startup-hook/manifest.cjs');
const exec=promisify(execFile);
test('hook failure and even a broken reporter never suppress or repeat original startup',()=>{
 let loads=0;assert.equal(boot({register(){throw Error('hook')},report(){throw Error('report')},loadOriginal(){loads++;return 42}}),42);assert.equal(loads,1);
 assert.throws(()=>boot({register(){},report(){},loadOriginal(){loads++;throw Error('original')}}),/original/);assert.equal(loads,2);
});
test('only hook-owned async and sync callbacks are contained',async()=>{
 const codes=[],report=code=>codes.push(code);await guardHook(()=>Promise.reject(Error('async')),report)();guardHook(()=>{throw Error('sync')},report)();assert.deepEqual(codes,['HOOK_RUNTIME_UNSUPPORTED','HOOK_RUNTIME_UNSUPPORTED']);
});
test('minimal main loader retains original main module, relative imports, argv and exceptions',async t=>{
 const root=await fixture(t),entry=path.join(root,'original.cjs');await fs.writeFile(path.join(root,'relative.cjs'),'module.exports=73');
 await fs.writeFile(entry,`console.log(JSON.stringify({main:require.main===module,parent:module.parent===null,file:__filename,relative:require('./relative.cjs'),argv:process.argv.slice(1)}));if(process.argv.includes('--fail'))throw Error('original sentinel');`);
 const wrapper=path.join(root,'wrapper.cjs');await fs.writeFile(wrapper,renderBootstrap({originalEntry:entry,brokerPath:path.join(root,'missing-broker.cjs'),payloadRoot:path.join(root,'payload'),payloadHash:'0'.repeat(64),reportFile:path.join(root,'probe.jsonl')}));
 async function run(file,args=[]){const driver=`process.argv=['node','fixture-app',...${JSON.stringify(args)}];require('node:module')._load(${JSON.stringify(file)},null,true)`;return exec(process.execPath,['-e',driver],{windowsHide:true})}
 assert.deepEqual(JSON.parse((await run(wrapper)).stdout),JSON.parse((await run(entry)).stdout));
 await assert.rejects(run(wrapper,['--fail']),e=>e.stderr.includes('original sentinel'));
});
test('sync payload loader rejects missing bytes, changed files, identity and symlinks',async t=>{
 const root=await fixture(t);await fs.writeFile(path.join(root,'probe.cjs'),'module.exports={}');const manifest=await createPayloadManifest({root,files:['probe.cjs']});await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest));const expectedHash=manifestHash(manifest);
 assert.equal(verifyPayloadSync({root,expectedHash}).files.length,1);
 assert.throws(()=>verifyPayloadSync({root,expectedHash:'0'.repeat(64)}),{code:'HOOK_HASH_MISMATCH'});
 await fs.writeFile(path.join(root,'probe.cjs'),'modified');assert.throws(()=>verifyPayloadSync({root,expectedHash}),{code:'HOOK_HASH_MISMATCH'});
 await fs.unlink(path.join(root,'probe.cjs'));assert.throws(()=>verifyPayloadSync({root,expectedHash}),{code:'HOOK_PAYLOAD_MISSING'});
 const outside=await fixture(t);await fs.writeFile(path.join(outside,'probe.cjs'),'module.exports={}');await fs.symlink(outside,path.join(root,'linked'),process.platform==='win32'?'junction':'dir');
 const linkedManifest={schemaVersion:1,files:[{...manifest.files[0],path:'linked/probe.cjs'}]};await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify(linkedManifest));assert.throws(()=>verifyPayloadSync({root,expectedHash:manifestHash(linkedManifest)}),{code:'HOOK_HASH_MISMATCH'});
});
