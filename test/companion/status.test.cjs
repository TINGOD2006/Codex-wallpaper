const {test}=require('node:test'),assert=require('node:assert/strict');
const {isObservationCurrent}=require('../../src/companion/status.cjs');
test('live application proof rejects stale heartbeats, wrong generations and undecoded frames',()=>{
 const current={instanceId:'m',generation:2,sessionId:'s2',pid:52,startTime:'200'},proof={...current,heartbeatAt:1000,connected:true,layoutPassed:true,stylesConfirmed:true,imageConfirmed:true,requestedImage:true,rendererHealthy:true};
 assert.equal(isObservationCurrent(proof,current,2000),true);
 for(const patch of [{heartbeatAt:2001},{generation:1},{startTime:'100'},{imageConfirmed:false},{connected:false}])assert.equal(isObservationCurrent({...proof,...patch},current,2000),false);
 assert.equal(isObservationCurrent(proof,current,12000),false);
});
test('a still-connected host cannot prove applied while its renderer is unhealthy',()=>{const current={instanceId:'m',generation:1,sessionId:'s',pid:7,startTime:'70'},proof={...current,heartbeatAt:100,connected:true,layoutPassed:true,stylesConfirmed:true,imageConfirmed:true,requestedImage:true,rendererHealthy:false};assert.equal(isObservationCurrent(proof,current,100),false)});
