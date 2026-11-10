const path=require('node:path'),fs=require('node:fs/promises'),{prepareCopy,verifyCopy,assertFixture,qualifyIsolation,cleanCopy}=require('../../src/startup-hook/copy-fixture.cjs');
const {safePath,hashFile,fault}=require('../../src/startup-hook/safe-io.cjs');
const {verifyPayload}=require('../../src/startup-hook/manifest.cjs');
async function main(){
 const args=process.argv.slice(2),keys=['--phase','--fixture','--source'];if(args.length%2||args.some((a,i)=>i%2===0&&!keys.includes(a))||new Set(args.filter((_,i)=>i%2===0)).size!==args.length/2)throw Error('Invalid arguments');const values=Object.fromEntries(Array.from({length:args.length/2},(_,i)=>[args[i*2],args[i*2+1]]));
 const base=path.resolve(__dirname,'../../.state/original-hook'),fixtureRoot=values['--fixture'];await fs.mkdir(base,{recursive:true});let result;
 switch(values['--phase']){
  case 'prepare':result=await prepareCopy({base,fixtureRoot,sourceRoot:values['--source'],onProgress:p=>process.stderr.write(JSON.stringify(p)+'\n')});break;
  case 'qualify':result=await qualifyIsolation({base,fixtureRoot});break;
  case 'inspect':result=await verifyCopy({base,fixtureRoot});break;
  case 'check-run':await verifyCopy({base,fixtureRoot});await assertFixture({base,fixtureRoot,forRun:true});result={ready:true};break;
  case 'check-probe':{
   const fixture=await assertFixture({base,fixtureRoot,forRun:true}),record=JSON.parse(await fs.readFile(await safePath(path.join(fixtureRoot,'candidate.json')),'utf8'));
   if(record.stage!=='probe'||record.sourceHash!==fixture.isolation.archiveHash||await hashFile(path.join(fixtureRoot,'app/resources/app.asar'))!==record.candidateHash||await hashFile(path.join(fixtureRoot,'backup/app.asar'))!==record.sourceHash)throw fault('HOOK_HASH_MISMATCH');
   const root=path.join(fixtureRoot,'payload'),manifest=JSON.parse(await fs.readFile(await safePath(path.join(root,'manifest.json')),'utf8'));await verifyPayload({root,manifest,expectedHash:record.payloadHash});result={ready:true};break;
  }
  case 'clean':result=await cleanCopy({base,fixtureRoot});break;
  default:throw Error('Unsupported phase');
 }
 process.stdout.write(JSON.stringify(result)+'\n');
}
if(require.main===module)main().catch(e=>{process.stderr.write((e.code||'HOOK_FIXTURE_UNSAFE')+'\n');process.exitCode=1});
module.exports={main};
