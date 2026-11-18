const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {readProjectMetadata}=require('../src/project-metadata.cjs');

test('metadata reader preserves fingerprint bytes and handles growth after stat within its size limit',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cw-metadata-growth-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const file=path.join(root,'project.json');
 const prefix='\uFEFF{"type":';
 const suffix='"scene","title":"測試"}';
 await fs.writeFile(file,prefix);
 const open=fs.open.bind(fs);
 const hook=t.mock.method(fs,'open',async(...args)=>{
  const handle=await open(...args);
  if(args[0]===file&&args[1]==='r'){
   const stat=handle.stat.bind(handle);
   handle.stat=async()=>{
    const before=await stat();
    await fs.appendFile(file,suffix);
    return before;
   };
  }
  return handle;
 });
 const result=await readProjectMetadata(file);
 hook.mock.restore();
 assert.deepEqual(result.project,{type:'scene',title:'測試'});
 assert.deepEqual(result.bytes,Buffer.from(prefix+suffix));
 assert.equal(result.stamp.size,Buffer.byteLength(prefix));
});

test('metadata exactly at 1 MiB is accepted and concurrently growing beyond it is rejected',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cw-metadata-limit-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const file=path.join(root,'project.json');
 const limit=1024*1024;
 await fs.writeFile(file,'{}'.padEnd(limit));
 assert.equal((await readProjectMetadata(file)).bytes.length,limit);
 const open=fs.open.bind(fs);
 t.mock.method(fs,'open',async(...args)=>{
  const handle=await open(...args);
  if(args[0]===file&&args[1]==='r'){
   const stat=handle.stat.bind(handle);
   handle.stat=async()=>{
    const before=await stat();
    await fs.appendFile(file,' ');
    return before;
   };
  }
  return handle;
 });
 await assert.rejects(readProjectMetadata(file),{code:'METADATA_TOO_LARGE'});
});
