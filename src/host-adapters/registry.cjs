const shell=require('./codex-shell.cjs');
function probeAdapter({host,structure}){
 if(host?.kind!=='codex-desktop')return {ok:false,kind:'unsupported',adapterId:null,adapterVersion:null,compatibility:'incompatible',requiredChecks:[],regions:{},reason:'HOST_TRANSPORT_UNAVAILABLE'};
 return shell.detectLayout(structure,host.appVersion);
}
module.exports={probeAdapter,adapters:[{id:'codex-shell',version:'1.0.1',hostKind:'codex-desktop',structureExpression:shell.structureExpression}]};
