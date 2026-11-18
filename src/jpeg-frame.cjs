// Chromium normally emits the start-of-frame marker within the first 768 bytes.
// Preserve the larger search window for JPEGs with embedded metadata.
const COMMON_HEADER_CHARS = 1024;
const MAX_HEADER_CHARS = 65536;

function scanDimensions(data){
  if(data.length<4||data[0]!==255||data[1]!==216)return null;
  let at=2;while(at+3<data.length){
    if(data[at++]!==255)return null;while(data[at]===255)at++;const marker=data[at++];
    if(marker===0xda||marker===0xd9||at+2>data.length)return null;
    const length=data.readUInt16BE(at);if(length<2)return null;
    if(marker>=0xc0&&marker<=0xcf&&![0xc4,0xc8,0xcc].includes(marker)){
      if(length<8||at+7>data.length)return null;const height=data.readUInt16BE(at+3),width=data.readUInt16BE(at+5);return width&&height?{width,height}:null;
    }
    at+=length;
  }return null;
}
function jpegDimensions(base64){
  if(typeof base64!=='string')return null;
  const size=scanDimensions(Buffer.from(base64.slice(0,COMMON_HEADER_CHARS),'base64'));
  if(size||base64.length<=COMMON_HEADER_CHARS)return size;
  return scanDimensions(Buffer.from(base64.slice(0,MAX_HEADER_CHARS),'base64'));
}
module.exports={jpegDimensions};
