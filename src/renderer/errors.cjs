const codes=new Set(['POOL_UNAVAILABLE','POOL_PROFILE_BUSY','POOL_TARGET_UNSUPPORTED','POOL_LOST','POOL_CLOSED','SOURCE_CHANGED','CACHE_UNAVAILABLE','CACHE_PRESSURE','FRAME_DIMENSION_MISMATCH','LEASE_DOCUMENT_CHANGED','OWNER_MISMATCH']);
function renderError(code,cause){if(!codes.has(code))throw new Error('Unknown renderer error');return Object.assign(new Error(code,{cause}),{code})}
const canFallback=error=>['POOL_UNAVAILABLE','POOL_PROFILE_BUSY','POOL_TARGET_UNSUPPORTED'].includes(error?.code);
function checkAbort(signal){if(signal?.aborted)throw signal.reason instanceof Error?signal.reason:new DOMException('Wallpaper preparation cancelled','AbortError')}
module.exports={renderError,canFallback,checkAbort};
