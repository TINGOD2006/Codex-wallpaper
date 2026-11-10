const path=require('node:path'),{randomUUID}=require('node:crypto'),{atomicJson}=require('../config.cjs');
const {sanitizeRendering}=require('../renderer/metrics.cjs');
async function exportDiagnostics({state,versions={},paths}){
 const observed=state.observed||{},report={schemaVersion:1,createdAt:new Date().toISOString(),versions,phase:state.phase,desiredEnabled:state.desired?.enabled===true,observed:{applied:observed.applied===true,connected:observed.connected===true,appVersion:observed.appVersion,adapterId:observed.adapterId,adapterVersion:observed.adapterVersion,compatibility:observed.compatibility,heartbeatAt:observed.heartbeatAt,regions:Object.fromEntries(Object.entries(observed.regions||{}).map(([key,value])=>[key,{supported:value.supported===true}]))},error:state.error?{code:state.error.code,stage:state.error.stage}:null,playback:{state:state.playback?.state,renderFps:state.playback?.renderFps,displayFps:state.playback?.displayFps}};
 report.rendering=sanitizeRendering(state.rendering);const fileName='diagnostics-'+randomUUID()+'.json';await atomicJson(path.join(paths.logs,fileName),report);return {fileName};
}
module.exports={exportDiagnostics};
