/* Shared pure admission rules: no browser or Node storage dependencies. */
(()=>{
 function canonicalBakeKey(raw,{origin,rendererBase,engineHash}){
  if(typeof raw!=='string'||raw.length>1024||typeof engineHash!=='string'||!/^[a-f0-9]{64}$/.test(engineHash)||/[\\%?#]/.test(raw))throw new TypeError('Invalid bake key');
  const root=new URL(origin),base=new URL(rendererBase);if(root.protocol!=='http:'||root.hostname!=='127.0.0.1'||root.username||root.password||root.search||root.hash||root.pathname!=='/'||base.origin!==root.origin||!base.pathname.endsWith('/'))throw new TypeError('Invalid bake origin');
  const canonicalPrefix='/__codex_bake__/'+engineHash+'/v1/';let key=raw;
  if(raw.startsWith('http:')||raw.startsWith('https:')){const url=new URL(raw);if(url.origin!==root.origin||url.username||url.password||url.hash||url.search)throw new TypeError('Foreign bake origin');if(url.pathname.startsWith(canonicalPrefix))key='bake3/v1/'+url.pathname.slice(canonicalPrefix.length);else if(url.pathname.startsWith(base.pathname))key=url.pathname.slice(base.pathname.length);else throw new TypeError('Foreign lease path')}
  if(!/^bake3\/v1\/[a-f0-9]{9,16}\/[a-f0-9]{9,16}\/[a-f0-9]{2}$/.test(key)||parseInt(key.slice(-2),16)>100)throw new TypeError('Unknown bake format');
  return root.origin+canonicalPrefix+key.slice('bake3/v1/'.length);
 }
 function planWrite({entries,pinnedFingerprints,key,fingerprint,newBytes,limitBytes,maxEntries=4096}){
  const text=value=>typeof value==='string'&&value.length>0&&value.length<=2048,positive=value=>Number.isSafeInteger(value)&&value>0;
  if(!Array.isArray(entries)||entries.length>8192||!Array.isArray(pinnedFingerprints)||!text(key)||!text(fingerprint)||!positive(newBytes)||!positive(limitBytes)||!positive(maxEntries)||maxEntries>4096)throw new TypeError('Invalid cache accounting');
  const seen=new Set();let used=0;for(const entry of entries){if(!entry||!text(entry.key)||seen.has(entry.key)||!text(entry.fingerprint)||!positive(entry.bytes)||!Number.isFinite(entry.lastUsed)||entry.lastUsed<0)throw new TypeError('Invalid cache entry');seen.add(entry.key);used+=entry.bytes;if(!Number.isSafeInteger(used))throw new TypeError('Cache accounting overflow')}
  const pinned=new Set(pinnedFingerprints),old=entries.find(e=>e.key===key),reject=()=>({store:false,reason:'CACHE_PRESSURE',evict:[]});
  if(newBytes>limitBytes||(old&&old.fingerprint!==fingerprint&&pinned.has(old.fingerprint)))return reject();
  used=used-(old?.bytes||0)+newBytes;let count=entries.length+(old?0:1);const evict=[];
  const candidates=entries.filter(e=>e.key!==key&&!pinned.has(e.fingerprint)).sort((a,b)=>a.lastUsed-b.lastUsed||(a.key<b.key?-1:a.key>b.key?1:0));
  for(const entry of candidates){if(used<=limitBytes&&count<=maxEntries)break;evict.push(entry.key);used-=entry.bytes;count--}
  if(used>limitBytes||count>maxEntries)return reject();return {store:true,evict,usedBytes:used,entryCount:count};
 }
 const api=Object.freeze({canonicalBakeKey,planWrite});if(typeof module==='object'&&module.exports)module.exports=api;else globalThis.CodexCachePolicy=api;
})();
