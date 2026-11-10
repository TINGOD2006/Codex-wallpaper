const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {fixture,archiveBytes,sourceFixture,addedFiles}=require('./fixtures.cjs');
const {readArchive,readEntry,buildCandidate,verifyCandidate}=require('../../src/startup-hook/archive.cjs');
test('candidate preserves original bytes, metadata and independent unpacked files',async t=>{
 const root=await fixture(t),{source}=await sourceFixture(root),before=await fs.readFile(source),destination=path.join(root,'candidate.asar');
 const diff=await buildCandidate({source,destination,main:'.codex-wallpaper/bootstrap.cjs',addedFiles});
 assert.deepEqual(diff.changedEntries,['package.json']);assert.deepEqual(diff.addedEntries,Object.keys(addedFiles));
 assert.equal((await verifyCandidate({source,candidate:destination,allowedMain:'.codex-wallpaper/bootstrap.cjs',addedFiles})).originalFilesVerified,3);
 assert.deepEqual(await fs.readFile(source),before);
 const a=await readArchive(source),b=await readArchive(destination);assert.deepEqual(a.entries.get('main.js'),b.entries.get('main.js'));
 assert.deepEqual(await readEntry(a,'main.js'),await readEntry(b,'main.js'));
 assert.notEqual((await fs.stat(source+'.unpacked/native/addon.node')).ino,(await fs.stat(destination+'.unpacked/native/addon.node')).ino);
});
test('malformed lengths, duplicate decoded keys, unsafe names, links and offsets are rejected',async t=>{
 const root=await fixture(t),file=path.join(root,'bad.asar');
 const headers=[{files:{'../escape':{size:0,offset:'0'}}},{files:{'a':{link:'main.js'}}},{files:{'a':{size:1,offset:'9007199254740992'}}},{files:{'a':{size:-1,offset:'0'}}},{files:{'a':{size:20,offset:'0'}}},{files:{'a':{size:0,offset:'0'},'A':{size:0,offset:'0'}}},'{"files":{"a":{"size":0,"offset":"0"},"\\u0061":{"size":0,"offset":"0"}}}'];
 for(const header of headers){await fs.writeFile(file,archiveBytes(header));await assert.rejects(readArchive(file),{code:'HOOK_ARCHIVE_INVALID'})}
 const valid=archiveBytes({files:{}});for(const index of [0,4,8,12]){const bad=Buffer.from(valid);bad.writeUInt32LE(0xffffffff,index);await fs.writeFile(file,bad);await assert.rejects(readArchive(file),{code:'HOOK_ARCHIVE_INVALID'})}
});
test('verification rejects changed original bytes or metadata, extra additions and package changes',async t=>{
 const root=await fixture(t),{source}=await sourceFixture(root),destination=path.join(root,'candidate.asar');await buildCandidate({source,destination,main:'.codex-wallpaper/bootstrap.cjs',addedFiles});
 const parsed=await readArchive(destination),body=(await fs.readFile(destination)).subarray(parsed.dataOffset),entry=parsed.entries.get('main.js');
 const changed=Buffer.from(body);changed[Number(entry.offset)]^=1;await fs.writeFile(destination,archiveBytes(parsed.header,changed));
 await assert.rejects(verifyCandidate({source,candidate:destination,allowedMain:'.codex-wallpaper/bootstrap.cjs',addedFiles}));
 entry.executable=false;await fs.writeFile(destination,archiveBytes(parsed.header,body));await assert.rejects(verifyCandidate({source,candidate:destination,allowedMain:'.codex-wallpaper/bootstrap.cjs',addedFiles}));
 entry.executable=true;parsed.header.files.extra={size:0,offset:'0'};await fs.writeFile(destination,archiveBytes(parsed.header,body));await assert.rejects(verifyCandidate({source,candidate:destination,allowedMain:'.codex-wallpaper/bootstrap.cjs',addedFiles}));
 delete parsed.header.files.extra;const pkg=parsed.entries.get('package.json'),badBody=Buffer.from(body);const text=badBody.subarray(Number(pkg.offset),Number(pkg.offset)+pkg.size).toString().replace('fixture','fIxture');Buffer.from(text).copy(badBody,Number(pkg.offset));await fs.writeFile(destination,archiveBytes(parsed.header,badBody));await assert.rejects(verifyCandidate({source,candidate:destination,allowedMain:'.codex-wallpaper/bootstrap.cjs',addedFiles}));
});
test('builder refuses overwrite, input/output alias and reserved namespace collision',async t=>{
 const root=await fixture(t),{source,header,body}=await sourceFixture(root);
 await assert.rejects(buildCandidate({source,destination:source,main:'.codex-wallpaper/bootstrap.cjs',addedFiles}));
 const destination=path.join(root,'existing.asar');await fs.writeFile(destination,'keep');await assert.rejects(buildCandidate({source,destination,main:'.codex-wallpaper/bootstrap.cjs',addedFiles}));assert.equal(await fs.readFile(destination,'utf8'),'keep');
 header.files['.codex-wallpaper']={files:{}};await fs.writeFile(source,archiveBytes(header,body));await assert.rejects(buildCandidate({source,destination:path.join(root,'new.asar'),main:'.codex-wallpaper/bootstrap.cjs',addedFiles}));
});
test('unpacked junction escape and truncation are rejected',async t=>{
 const root=await fixture(t),{source}=await sourceFixture(root),outside=path.join(root,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'addon.node'),'native');
 await fs.rename(source+'.unpacked/native',source+'.unpacked/saved');await fs.symlink(outside,source+'.unpacked/native',process.platform==='win32'?'junction':'dir');
 await assert.rejects(readArchive(source));await fs.unlink(source+'.unpacked/native');await fs.rename(source+'.unpacked/saved',source+'.unpacked/native');await fs.writeFile(source+'.unpacked/native/addon.node','x');await assert.rejects(readArchive(source));
});
test('unpacked post-packaging bytes are copied in full while archive metadata stays unchanged',async t=>{
 const root=await fixture(t),{source}=await sourceFixture(root),native=source+'.unpacked/native/addon.node';await fs.appendFile(native,'post-packaging signature fixture');
 const destination=path.join(root,'candidate.asar');await buildCandidate({source,destination,main:'.codex-wallpaper/bootstrap.cjs',addedFiles});
 assert.deepEqual(await fs.readFile(destination+'.unpacked/native/addon.node'),await fs.readFile(native));
 assert.equal((await readArchive(destination)).entries.get('native/addon.node').size,6);
 await fs.appendFile(destination+'.unpacked/native/addon.node','unexpected');await assert.rejects(verifyCandidate({source,candidate:destination,allowedMain:'.codex-wallpaper/bootstrap.cjs',addedFiles}));
});
