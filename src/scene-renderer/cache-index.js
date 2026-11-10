/* Owned metadata only; PNG payloads remain in the upstream Cache Storage. */
(()=>{
 const request=value=>new Promise((resolve,reject)=>{value.onsuccess=()=>resolve(value.result);value.onerror=()=>reject(value.error)});
 async function openCacheIndex(){
  const opening=indexedDB.open('codex-wallpaper-cache-index-v1',1);opening.onupgradeneeded=()=>{const db=opening.result;db.createObjectStore('entries',{keyPath:'key'});db.createObjectStore('state',{keyPath:'id'})};const db=await request(opening);
  return {
   readState(){return request(db.transaction('state').objectStore('state').get('state'))},
   entries(){return request(db.transaction('entries').objectStore('entries').getAll())},
   commit({state,entries=[],remove=[],replace=false}){return new Promise((resolve,reject)=>{const tx=db.transaction(['state','entries'],'readwrite');tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||new Error('Cache index aborted'));tx.onerror=()=>{};const store=tx.objectStore('entries');if(replace)store.clear();for(const key of remove)store.delete(key);for(const entry of entries)store.put(entry);if(state)tx.objectStore('state').put({...state,id:'state'})})},
   close(){db.close()}
  };
 }
 window.openCacheIndex=openCacheIndex;
})();
