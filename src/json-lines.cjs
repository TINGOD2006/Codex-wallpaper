// Bounded incremental decoding for the owned PowerShell workers. Limits apply
// to each record, not to a pipe chunk (which may contain many valid records).
function createJsonLines({onValue,onOverflow,maxLength=8192}){
  let pending='',failed=false;
  return chunk=>{
    if(failed)return;
    let start=0;
    while(start<chunk.length){
      const end=chunk.indexOf('\n',start),stop=end<0?chunk.length:end;
      if(pending.length+stop-start>maxLength){failed=true;pending='';onOverflow();return}
      pending+=chunk.slice(start,stop);
      if(end<0)return;
      let value,valid=false;
      try{value=JSON.parse(pending);valid=true}catch{}
      pending='';start=end+1;
      if(valid)onValue(value);
    }
  };
}
module.exports={createJsonLines};
