const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const paletteKeys = ['surface','panel','text','muted','accent','selection'];
const configKeys = ['backgroundPath','positionX','overlayOpacity','palette'];
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function checkKeys(value, keys) {
  if (!object(value) || Object.keys(value).some(key=>!keys.includes(key))) throw new Error('Invalid settings object or unknown property');
}
function validateConfig(value) {
  checkKeys(value,configKeys); checkKeys(value.palette,paletteKeys);
  if (typeof value.backgroundPath !== 'string' || !value.backgroundPath.trim() || value.backgroundPath.includes('\0')) throw new Error('Invalid background path');
  if (!Number.isFinite(value.positionX) || value.positionX<0 || value.positionX>100) throw new Error('positionX must be between 0 and 100');
  if (!Number.isFinite(value.overlayOpacity) || value.overlayOpacity<0 || value.overlayOpacity>1) throw new Error('overlayOpacity must be between 0 and 1');
  for (const key of paletteKeys) if (typeof value.palette[key] !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value.palette[key])) throw new Error(`Invalid palette color: ${key}`);
  return {...value,palette:{...value.palette}};
}
async function readJson(file) { return JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,'')); }
async function atomicJson(file,value) {
  await fs.mkdir(path.dirname(file),{recursive:true});
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary,`${JSON.stringify(value,null,2)}\n`,{flag:'wx',mode:0o600});
    for(let attempt=0;;attempt++){
      try{await fs.rename(temporary,file);break}
      catch(error){
        if(attempt>=5||!['EPERM','EACCES','EBUSY'].includes(error.code))throw error;
        // Windows readers/scanners can briefly deny replacement; never publish a partial file.
        await new Promise(resolve=>setTimeout(resolve,20*2**attempt));
      }
    }
  } finally { await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;}); }
}
async function loadConfig(file) {
  const value = validateConfig(await readJson(file));
  return {...value,backgroundPath:path.resolve(path.dirname(file),value.backgroundPath)};
}
async function loadImage(file) {
  const handle = await fs.open(file,'r');
  let data;
  try {
    const stat=await handle.stat();
    if (!stat.isFile()) throw new Error('Background must be an image file');
    if (stat.size>MAX_IMAGE_BYTES) throw new Error('Background image exceeds 10 MiB');
    const buffer=Buffer.alloc(Math.min(MAX_IMAGE_BYTES+1,stat.size+1));
    const {bytesRead}=await handle.read(buffer,0,buffer.length,0);
    if(bytesRead>MAX_IMAGE_BYTES)throw new Error('Background image exceeds 10 MiB');
    data=buffer.subarray(0,bytesRead);
  } finally { await handle.close(); }
  let mime;
  if (data.length>=45 && data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && data.toString('ascii',12,16)==='IHDR' && data.readUInt32BE(16)>0 && data.readUInt32BE(20)>0 && data.toString('ascii',data.length-8,data.length-4)==='IEND') mime='image/png';
  else if(data.length>=24 && data[0]===255 && data[1]===216 && data[2]===255 && data[data.length-2]===255 && data[data.length-1]===217)mime='image/jpeg';
  else if(data.length>=20 && data.toString('ascii',0,4)==='RIFF' && data.toString('ascii',8,12)==='WEBP' && ['VP8 ','VP8L','VP8X'].includes(data.toString('ascii',12,16)) && data.readUInt32LE(4)+8===data.length)mime='image/webp';
  if(!mime)throw new Error('Invalid or truncated image; PNG, JPEG and WebP are supported');
  return {mime,dataUri:`data:${mime};base64,${data.toString('base64')}`};
}
async function saveConfig(file,patch) {
  checkKeys(patch,configKeys);
  if(patch.palette!==undefined)checkKeys(patch.palette,paletteKeys);
  const current=validateConfig(await readJson(file));
  const next=validateConfig({...current,...patch,palette:{...current.palette,...patch.palette}});
  await loadImage(path.resolve(path.dirname(file),next.backgroundPath));
  await atomicJson(file,next);
  return loadConfig(file);
}
module.exports={loadConfig,saveConfig,loadImage,validateConfig,atomicJson,readJson};
