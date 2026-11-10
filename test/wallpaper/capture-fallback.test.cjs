const {test}=require('node:test'),assert=require('node:assert/strict');
const {SceneEngine}=require('../../src/scene-engine.cjs'),{jpegDimensions}=require('../../src/jpeg-frame.cjs');
function jpeg(width,height){const bytes=Buffer.from('ffd8ffc00011080000000003012200021101031101ffd9','hex');bytes.writeUInt16BE(height,7);bytes.writeUInt16BE(width,9);return bytes.toString('base64')}
test('scene fallback captures the compositor at full dimensions without reading a cleared canvas',async()=>{
 const engine=new SceneEngine({width:1920,height:1020,entry:{kind:'scene'}}),calls=[];
 engine.status={state:'ready',frames:0};engine.client={connected:true,evaluate:async expression=>{assert.equal(expression.includes('toDataURL'),false);return {state:{state:'ready'},stats:{fps:30},paused:false}},send:async(method,params)=>{calls.push({method,params});return {data:jpeg(1920,1020)}}};
 assert.match(await engine.frame(),/^data:image\/jpeg;base64,/);assert.equal(calls[0].method,'Page.captureScreenshot');assert.deepEqual(calls[0].params.clip,{x:0,y:0,width:1920,height:1020,scale:1});assert.equal(calls[0].params.quality,92);
 engine.client.send=async()=>({data:jpeg(1024,660)});await assert.rejects(()=>engine.frame(),/dimensions/);
});
test('JPEG size gate rejects malformed headers and accepts baseline and progressive dimensions',()=>{
 assert.deepEqual(jpegDimensions(jpeg(640,360)),{width:640,height:360});const progressive=Buffer.from(jpeg(400,700),'base64');progressive[3]=0xc2;assert.deepEqual(jpegDimensions(progressive.toString('base64')),{width:400,height:700});
 for(const value of ['',null,'not an image',Buffer.from('ffd8ffda0000ffd9','hex').toString('base64'),jpeg(0,720)])assert.equal(jpegDimensions(value),null);
});
