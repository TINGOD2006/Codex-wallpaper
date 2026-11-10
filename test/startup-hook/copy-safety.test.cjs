const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {fixture}=require('./fixtures.cjs');
const {prepareCopy,verifyCopy,assertFixture,cleanCopy}=require('../../src/startup-hook/copy-fixture.cjs');
async function source(root){const sourceRoot=path.join(root,'official');await fs.mkdir(sourceRoot);await fs.writeFile(path.join(sourceRoot,'ChatGPT.exe'),'fixture exe');await fs.mkdir(path.join(sourceRoot,'resources'));await fs.writeFile(path.join(sourceRoot,'resources/app.asar'),'fixture archive');return sourceRoot}
test('copy is exclusive, independently hashed and requires an owned UUID root',async t=>{
 const root=await fixture(t),sourceRoot=await source(root),base=path.join(root,'fixtures');await fs.mkdir(base);const fixtureRoot=path.join(base,randomUUID());
 await prepareCopy({base,fixtureRoot,sourceRoot});assert.equal((await verifyCopy({base,fixtureRoot})).filesVerified,2);
 assert.notEqual((await fs.stat(path.join(fixtureRoot,'app/ChatGPT.exe'))).ino,(await fs.stat(path.join(sourceRoot,'ChatGPT.exe'))).ino);
 await assert.rejects(prepareCopy({base,fixtureRoot,sourceRoot}));await assert.rejects(assertFixture({base,fixtureRoot:sourceRoot}));
 await fs.writeFile(path.join(fixtureRoot,'app/ChatGPT.exe'),'changed');await assert.rejects(verifyCopy({base,fixtureRoot}));
});
test('cleanup refuses non-fixtures and escaped children, then removes only the verified root',async t=>{
 const root=await fixture(t),sourceRoot=await source(root),base=path.join(root,'fixtures');await fs.mkdir(base);const fixtureRoot=path.join(base,randomUUID());await prepareCopy({base,fixtureRoot,sourceRoot});
 await assert.rejects(cleanCopy({base,fixtureRoot:sourceRoot}));await fs.symlink(sourceRoot,path.join(fixtureRoot,'escape'),process.platform==='win32'?'junction':'dir');await assert.rejects(cleanCopy({base,fixtureRoot}));assert.equal(await fs.readFile(path.join(sourceRoot,'ChatGPT.exe'),'utf8'),'fixture exe');
 await fs.unlink(path.join(fixtureRoot,'escape'));assert.equal((await cleanCopy({base,fixtureRoot})).removed,true);assert.equal(await fs.readFile(path.join(sourceRoot,'ChatGPT.exe'),'utf8'),'fixture exe');
});
test('missing marker, junction, hardlink and absent isolation evidence never qualify a run',async t=>{
 const root=await fixture(t),sourceRoot=await source(root),base=path.join(root,'fixtures');await fs.mkdir(base);const fixtureRoot=path.join(base,randomUUID());await fs.mkdir(fixtureRoot);
 await assert.rejects(assertFixture({base,fixtureRoot}));const good=path.join(base,randomUUID());await prepareCopy({base,fixtureRoot:good,sourceRoot});
 await assert.rejects(assertFixture({base,fixtureRoot:good,forRun:true}));
 await fs.unlink(path.join(good,'app/ChatGPT.exe'));await fs.link(path.join(sourceRoot,'ChatGPT.exe'),path.join(good,'app/ChatGPT.exe'));await assert.rejects(verifyCopy({base,fixtureRoot:good}));
 const linked=path.join(base,randomUUID());await fs.symlink(good,linked,process.platform==='win32'?'junction':'dir');await assert.rejects(assertFixture({base,fixtureRoot:linked}));
});
