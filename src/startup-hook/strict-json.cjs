const {fault}=require('./safe-io.cjs');
// Bounded JSON parser: reject duplicate decoded keys before an object can lose them.
function parseStrictJson(text){
 let at=0,nodes=0;const whitespace=()=>{while(/[\x20\t\r\n]/.test(text[at]||'!'))at++};
 function string(){const start=at++;while(at<text.length){const c=text[at++];if(c==='"')return JSON.parse(text.slice(start,at));if(c==='\\')at++;if(c<' ')throw fault()}throw fault()}
 function value(depth){if(depth>128||++nodes>2000000)throw fault();whitespace();const c=text[at];
  if(c==='"')return string();
  if(c==='{'||c==='['){at++;const object=c==='{',result=object?Object.create(null):[],keys=new Set(),end=object?'}':']';whitespace();if(text[at]===end){at++;return result}
   for(;;){whitespace();let key;if(object){if(text[at]!=='"')throw fault();key=string();if(keys.has(key))throw fault();keys.add(key);whitespace();if(text[at++]!==':')throw fault()}
    const child=value(depth+1);if(object)result[key]=child;else result.push(child);whitespace();if(text[at]===end){at++;return result}if(text[at++]!==',')throw fault();
   }
  }
  const match=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(at));if(!match)throw fault();at+=match[0].length;const result=JSON.parse(match[0]);if(typeof result==='number'&&!Number.isFinite(result))throw fault();return result;
 }
 try{const result=value(0);whitespace();if(at!==text.length)throw fault();return result}catch{throw fault()}
}
module.exports={parseStrictJson};
