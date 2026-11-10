const {test}=require('node:test'),assert=require('node:assert/strict');
const {createJsonLines}=require('../src/json-lines.cjs');

test('worker records survive arbitrary chunk boundaries and malformed neighbors',()=>{
  const values=[];let overflow=0;
  const read=createJsonLines({onValue:v=>values.push(v),onOverflow:()=>overflow++});
  read('{"state":"re');read('ady"}\r');read('\nnot json\nnull\n{"visible":');read('true}\n');
  assert.deepEqual(values,[{state:'ready'},null,{visible:true}]);assert.equal(overflow,0);
});
test('coalesced pipe output is bounded per record, not per chunk',()=>{
  let count=0,overflow=0;
  const read=createJsonLines({maxLength:32,onValue:()=>count++,onOverflow:()=>overflow++});
  read('{"visible":true}\n'.repeat(1000));
  assert.equal(count,1000);assert.equal(overflow,0);
});
test('oversized partial and complete records stop parsing once and drop retained output',()=>{
  for(const fragments of [['x'.repeat(33)+'\n'],['x'.repeat(20),'x'.repeat(13)]]){
    let overflow=0,count=0;const read=createJsonLines({maxLength:32,onValue:()=>count++,onOverflow:()=>overflow++});
    fragments.forEach(read);read('{"visible":true}\n');read('x'.repeat(40));
    assert.equal(overflow,1);assert.equal(count,0);
  }
});
