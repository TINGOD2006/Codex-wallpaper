const fs=require('node:fs/promises'),path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const {assertFixture,verifyCopy}=require('../src/startup-hook/copy-fixture.cjs');
const {safePath,hashFile,fault}=require('../src/startup-hook/safe-io.cjs');
const {createPayloadManifest,manifestHash}=require('../src/startup-hook/manifest.cjs');
const {buildCandidate}=require('../src/startup-hook/archive.cjs');
const {renderBootstrap}=require('../src/startup-hook/bootstrap.cjs');
const run=promisify(execFile),base=path.resolve(__dirname,'../.state/original-hook');
async function buildProbe({fixtureRoot,baselineRoot,allowUnverifiedExit=false}){
 fixtureRoot=path.resolve(fixtureRoot);baselineRoot=path.resolve(baselineRoot);if(fixtureRoot===baselineRoot)throw fault('HOOK_FIXTURE_UNSAFE');
 await assertFixture({base,fixtureRoot,forRun:true});await assertFixture({base,fixtureRoot:baselineRoot,forRun:true});
 const baseline=JSON.parse(await fs.readFile(await safePath(path.join(baselineRoot,'baseline-result.json')),'utf8'));
 if(!baseline.windowReady||!baseline.singleInstance||!baseline.isolatedProfileCreated||!baseline.sourceArchiveUnchanged||!baseline.normalExit&&!allowUnverifiedExit)throw fault('HOOK_BASELINE_FAILED');
 await verifyCopy({base,fixtureRoot});
 // argv is a separate argument: no path is interpolated into PowerShell source.
 const check=await run('pwsh',['-NoProfile','-File',path.resolve(__dirname,'hook-fixture-idle.ps1'),'-FixtureRoot',fixtureRoot],{windowsHide:true,timeout:10000});if(check.stdout.trim()!=='idle')throw fault('HOOK_FIXTURE_ALREADY_RUNNING');
 const payloadRoot=path.join(fixtureRoot,'payload');await fs.mkdir(payloadRoot);
 await fs.copyFile(path.resolve(__dirname,'../src/startup-hook/probe.cjs'),path.join(payloadRoot,'probe.cjs'),fs.constants.COPYFILE_EXCL);
 const payload=await createPayloadManifest({root:payloadRoot,files:['probe.cjs']}),payloadHash=manifestHash(payload);await fs.writeFile(path.join(payloadRoot,'manifest.json'),JSON.stringify(payload),{flag:'wx'});
 const config={originalEntry:'.vite/build/early-bootstrap.js',payloadRoot,payloadHash,reportFile:path.join(fixtureRoot,'logs/probe.jsonl'),nodePath:process.execPath};
 const addedFiles={'.codex-wallpaper/bootstrap.cjs':Buffer.from(renderBootstrap(config)),'.codex-wallpaper/host-broker.cjs':await fs.readFile(path.resolve(__dirname,'../src/startup-hook/host-broker.cjs'))};
 const stage=path.join(fixtureRoot,'candidate'),backup=path.join(fixtureRoot,'backup');await fs.mkdir(stage);await fs.mkdir(backup);
 const target=path.join(fixtureRoot,'app/resources/app.asar'),candidate=path.join(stage,'app.asar'),saved=path.join(backup,'app.asar');
 const diff=await buildCandidate({source:target,destination:candidate,main:'.codex-wallpaper/bootstrap.cjs',addedFiles});
 // Fixture-only, never installed WindowsApps. All four source/target parents were fenced.
 for(const file of [target,candidate,saved])await safePath(file,{missingLeaf:true});
 await fs.rename(target,saved);await fs.rename(target+'.unpacked',saved+'.unpacked');await fs.rename(candidate,target);await fs.rename(candidate+'.unpacked',target+'.unpacked');
 const record={schemaVersion:1,stage:'probe',...diff,payloadHash,bootstrapHash:await hashFile(path.join(payloadRoot,'probe.cjs')),baselineExitVerified:baseline.normalExit===true,baselineExitDeferred:!baseline.normalExit&&allowUnverifiedExit};
 await fs.writeFile(path.join(fixtureRoot,'candidate.json'),JSON.stringify(record,null,2),{flag:'wx'});return {stage:record.stage,sourceHash:record.sourceHash,candidateHash:record.candidateHash,baselineExitVerified:record.baselineExitVerified};
}
async function main(){const args=process.argv.slice(2),allow=args.includes('--allow-unverified-exit'),filtered=args.filter(a=>a!=='--allow-unverified-exit');if(filtered.length!==6)throw fault('HOOK_FIXTURE_UNSAFE');const v=Object.fromEntries(Array.from({length:3},(_,i)=>[filtered[i*2],filtered[i*2+1]]));if(Object.keys(v).sort().join(',')!=='--baseline,--fixture,--stage'||v['--stage']!=='probe')throw fault('HOOK_FIXTURE_UNSAFE');console.log(JSON.stringify(await buildProbe({fixtureRoot:v['--fixture'],baselineRoot:v['--baseline'],allowUnverifiedExit:allow})))}
if(require.main===module)main().catch(e=>{console.error(e.code||'HOOK_RUNTIME_UNSUPPORTED');process.exitCode=1});
module.exports={buildProbe};
