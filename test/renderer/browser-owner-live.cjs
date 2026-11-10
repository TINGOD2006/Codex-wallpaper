const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {createBrowserOwner}=require('../../src/renderer/browser-owner.cjs');
(async()=>{
 const root=path.resolve('.state/renderer-owner-live-'+Date.now()),paths={runtime:path.join(root,'runtime'),data:path.join(root,'data')};
 const owner=createBrowserOwner({paths}),contender=createBrowserOwner({paths}),server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Owned renderer fixture</title>fixture')});let a,b,control;
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;await owner.start();await assert.rejects(contender.start(),{code:'POOL_PROFILE_BUSY'});assert.equal(owner.snapshot().connected,true);control=await owner.openTarget({url:origin+'/control/',width:800,height:600,role:'control'});
  a=await owner.openTarget({url:origin+'/fixture-a/',width:640,height:400});b=await owner.openTarget({url:origin+'/fixture-b/',width:800,height:500});
  const before=owner.snapshot();assert.equal(before.contentTargets,2);assert.equal(before.controlTargets,1);
  await a.close();assert.equal(await b.client.evaluate('1+1'),2);assert.equal(owner.snapshot().contentTargets,1);
  await b.close();await control.close();await owner.stop();assert.equal(owner.snapshot().connected,false);
  const identity=JSON.parse(await fs.readFile(path.join(paths.runtime,'renderer-pool/browser.json')));await assert.rejects(fetch('http://127.0.0.1:'+identity.port+'/json/version',{signal:AbortSignal.timeout(1000)}));
  console.log(JSON.stringify({passed:true,browserVersion:before.browserVersion,contentTargets:2,controlTargets:1,profileBusyRejected:true,independentClose:true,endpointClosed:true}));
 }finally{await contender.close();await owner.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections()})}
})().catch(error=>{console.error(error);process.exitCode=1});
