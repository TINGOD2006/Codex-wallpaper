const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createMediaServer}=require('../../src/scene-server.cjs');
test('video resources stream validated single byte ranges without exposing other files',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'wallpaper-media-')),mediaPath=path.join(directory,'video.mp4');await fs.writeFile(mediaPath,Buffer.from('0123456789'));
  const server=await createMediaServer({kind:'video',directory,mediaPath,title:'Video'});
  try{
    const response=await fetch(server.url+'media.mp4',{headers:{Range:'bytes=2-5'}});assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 2-5/10');assert.equal(await response.text(),'2345');
    assert.equal((await fetch(server.url+'media.mp4',{headers:{Range:'bytes=50-60'}})).status,416);
    assert.equal(await(await fetch(server.url+'media.mp4',{headers:{Range:'bytes=-2'}})).text(),'89');
    const head=await fetch(server.url+'media.mp4',{method:'HEAD'});assert.equal(head.headers.get('content-length'),'10');assert.equal(await head.text(),'');
    assert.equal((await fetch(server.url+'unknown.mp4')).status,404);
  }finally{await server.close()}
});
