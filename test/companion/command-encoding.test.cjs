const {test}=require('node:test'),assert=require('node:assert/strict');
const {encodeReply}=require('../../src/companion/command.cjs');
test('launcher JSON survives legacy Windows console decoding with Chinese, quotes and supplementary characters',()=>{
 const original={state:{error:{message:'新版介面（需要確認：模式選單） "quoted" 桌布🎵'},path:'C:\\使用者\\預設'},ok:false};
 const wire=encodeReply(original);assert.match(wire,/^[\x00-\x7f]+$/);assert.equal(wire.endsWith('\n'),true);
 for(const encoding of ['utf-8','gbk','big5','windows-1252'])assert.deepEqual(JSON.parse(new TextDecoder(encoding).decode(Buffer.from(wire))),original);
});
