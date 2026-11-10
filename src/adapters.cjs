const adapter=require('./host-adapters/codex-shell.cjs');
function guardFor(snapshot){const {documentToken,themeStylePresent,...structure}=snapshot;return {documentToken,structureKey:JSON.stringify(structure)}}
module.exports={...adapter,guardFor};
