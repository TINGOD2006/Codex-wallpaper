function parseRange(value,size){
 if(value===undefined)return {start:0,end:size-1,partial:false};
 const match=/^bytes=(\d*)-(\d*)$/.exec(value);if(!match||(!match[1]&&!match[2]))return null;
 let start=0,end=size-1;
 if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<=0)return null;start=Math.max(0,size-suffix)}
 else{start=Number(match[1]);if(match[2])end=Math.min(Number(match[2]),end)}
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||start>end)return null;
 return {start,end,partial:true};
}
module.exports={parseRange};
