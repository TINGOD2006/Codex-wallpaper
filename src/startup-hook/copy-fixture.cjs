const fs=require('node:fs/promises'),path=require('node:path'),{constants}=require('node:fs');
const {fault,safePath,relativeName,hashFile,sameStamp}=require('./safe-io.cjs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ORIGINAL_HASH='6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074';
async function location(base,fixtureRoot){base=await safePath(base);fixtureRoot=path.resolve(fixtureRoot);if(path.dirname(fixtureRoot)!==base||!UUID.test(path.basename(fixtureRoot)))throw fault('HOOK_FIXTURE_UNSAFE');await safePath(fixtureRoot,{missingLeaf:true});return fixtureRoot}
async function inventory(root){const files=[];async function walk(dir,prefix=''){for(const item of await fs.readdir(dir,{withFileTypes:true})){const name=prefix?prefix+'/'+item.name:item.name;relativeName(name);const file=await safePath(path.join(root,...name.split('/'))),stat=await fs.lstat(file);if(stat.isDirectory())await walk(file,name);else if(stat.isFile())files.push({path:name,size:stat.size,stat});else throw fault('HOOK_FIXTURE_UNSAFE')}}await walk(await safePath(root));return files.sort((a,b)=>a.path.localeCompare(b.path))}
async function prepareCopy({base,fixtureRoot,sourceRoot,onProgress=()=>{}}){
 fixtureRoot=await location(base,fixtureRoot);sourceRoot=await safePath(sourceRoot);if(sourceRoot.startsWith(fixtureRoot)||fixtureRoot.startsWith(sourceRoot+path.sep))throw fault('HOOK_FIXTURE_UNSAFE');
 const files=await inventory(sourceRoot),bytes=files.reduce((n,f)=>n+f.size,0),space=await fs.statfs(base);if(space.bavail*space.bsize<bytes+2*1024**3)throw fault('HOOK_FIXTURE_SPACE');
 await fs.mkdir(fixtureRoot);const manifest={schemaVersion:1,kind:'codex-original-hook-fixture',id:path.basename(fixtureRoot),sourceRoot,files:[],totalBytes:bytes,prepared:false};
 await fs.writeFile(path.join(fixtureRoot,'fixture.json'),JSON.stringify(manifest),{flag:'wx'});
 for(const directory of ['app','profile','agent-home','wallpaper','temp','roaming','local','logs'])await fs.mkdir(path.join(fixtureRoot,directory));
 let count=0;for(const file of files){const from=path.join(sourceRoot,...file.path.split('/')),to=path.join(fixtureRoot,'app',...file.path.split('/'));await fs.mkdir(path.dirname(to),{recursive:true});await safePath(path.dirname(to));await fs.copyFile(from,to,constants.COPYFILE_EXCL);await safePath(to,{singleLink:true});const sha256=await hashFile(from);if(!sameStamp(file.stat,await fs.stat(from))||sha256!==await hashFile(to))throw fault('HOOK_HASH_MISMATCH');manifest.files.push({path:file.path,size:file.size,sha256});if(++count%250===0)onProgress({copiedFiles:count,totalFiles:files.length})}
 manifest.prepared=true;await fs.writeFile(path.join(fixtureRoot,'fixture.json'),JSON.stringify(manifest,null,2));return {fixtureRoot,files:files.length,bytes};
}
async function assertFixture({base,fixtureRoot,forRun=false}){
 fixtureRoot=await location(base,fixtureRoot);const marker=await safePath(path.join(fixtureRoot,'fixture.json'),{singleLink:true});if((await fs.stat(marker)).size>8*1024*1024)throw fault('HOOK_FIXTURE_UNSAFE');const m=JSON.parse(await fs.readFile(marker,'utf8'));
 if(m.schemaVersion!==1||m.kind!=='codex-original-hook-fixture'||m.id!==path.basename(fixtureRoot)||!m.prepared||!Array.isArray(m.files)||m.files.length>50000)throw fault('HOOK_FIXTURE_UNSAFE');
 const seen=new Set();for(const f of m.files){relativeName(f.path);if(seen.has(f.path.toLowerCase())||!Number.isSafeInteger(f.size)||f.size<0||!/^[a-f0-9]{64}$/.test(f.sha256))throw fault('HOOK_FIXTURE_UNSAFE');seen.add(f.path.toLowerCase())}
 if(forRun){const q=m.isolation;if(!q||q.archiveHash!==ORIGINAL_HASH||q.archiveHash!==m.files.find(f=>f.path==='resources/app.asar')?.sha256||q.explicitUserData!==true||q.explicitAgentHome!==true||q.singleInstance!==true)throw fault('HOOK_ISOLATION_UNPROVEN')}
 return m;
}
async function verifyCopy({base,fixtureRoot}){
 const manifest=await assertFixture({base,fixtureRoot}),app=path.join(fixtureRoot,'app'),actual=await inventory(app);if(actual.length!==manifest.files.length)throw fault('HOOK_HASH_MISMATCH');
 for(const file of manifest.files){const p=await safePath(path.join(app,...file.path.split('/')),{singleLink:true});if((await fs.stat(p)).size!==file.size||await hashFile(p)!==file.sha256)throw fault('HOOK_HASH_MISMATCH')}
 return {filesVerified:manifest.files.length};
}
async function qualifyIsolation({base,fixtureRoot}){
 const m=await assertFixture({base,fixtureRoot}),file=path.join(fixtureRoot,'app/resources/app.asar');if(await hashFile(file)!==ORIGINAL_HASH)throw fault('HOOK_VERSION_UNSUPPORTED');
 const {readArchive,readEntry}=require('./archive.cjs'),a=await readArchive(file),bundle=(await readEntry(a,'.vite/build/early-bootstrap-339-096ec1020e8592e0.js')).toString('utf8'),agent=(await readEntry(a,'.vite/build/early-bootstrap-824-e56448c7829c41c2.js')).toString('utf8');
 const checks={explicitUserData:bundle.includes('let r=n.CODEX_ELECTRON_USER_DATA_PATH?.trim();if(r)return(0,g.resolve)(r)'),explicitAgentHome:agent.includes('return process.env.CODEX_HOME??'),singleInstance:bundle.includes('hasExplicitUserDataPath:n=!1}){return!!t&&(!e||n)}')&&bundle.includes('r.app.requestSingleInstanceLock(')};
 if(Object.values(checks).some(v=>!v))throw fault('HOOK_ISOLATION_UNPROVEN');m.isolation={archiveHash:ORIGINAL_HASH,...checks};await fs.writeFile(path.join(fixtureRoot,'fixture.json'),JSON.stringify(m,null,2));return checks;
}
async function cleanCopy({base,fixtureRoot}){
 await assertFixture({base,fixtureRoot});await inventory(fixtureRoot); // Reject reparse points before recursion.
 await location(base,fixtureRoot);await fs.rm(fixtureRoot,{recursive:true,force:false});return {removed:true};
}
module.exports={prepareCopy,verifyCopy,assertFixture,qualifyIsolation,cleanCopy};
