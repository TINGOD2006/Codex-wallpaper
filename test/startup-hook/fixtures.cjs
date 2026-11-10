const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cw-hook-test-'));const real=await fs.realpath(root);t.after(async()=>{if(await fs.realpath(root)!==real||!path.basename(real).startsWith('cw-hook-test-'))throw Error('Unsafe fixture cleanup');await fs.rm(root,{recursive:true,force:true})});return root}
function archiveBytes(header,body=Buffer.alloc(0)){
 const json=Buffer.from(typeof header==='string'?header:JSON.stringify(header));
 const size=8+Math.ceil(json.length/4)*4,buffer=Buffer.alloc(8+size);
 buffer.writeUInt32LE(4,0);buffer.writeUInt32LE(size,4);buffer.writeUInt32LE(size-4,8);buffer.writeUInt32LE(json.length,12);json.copy(buffer,16);
 return Buffer.concat([buffer,body]);
}
async function sourceFixture(root){const pkg=Buffer.from(JSON.stringify({name:'fixture',main:'main.js',version:'1.0.0'})),code=Buffer.from('module.exports=42;');const source=path.join(root,'source.asar'),header={files:{'package.json':{size:pkg.length,offset:'0'},'main.js':{size:code.length,offset:String(pkg.length),executable:true},native:{files:{'addon.node':{size:6,unpacked:true}}}}};await fs.writeFile(source,archiveBytes(header,Buffer.concat([pkg,code])));await fs.mkdir(source+'.unpacked/native',{recursive:true});await fs.writeFile(source+'.unpacked/native/addon.node','native');return {source,header,body:Buffer.concat([pkg,code])}}
const addedFiles={'.codex-wallpaper/bootstrap.cjs':Buffer.from('/* bootstrap fixture */'),'.codex-wallpaper/host-broker.cjs':Buffer.from('/* broker fixture */')};
module.exports={fixture,archiveBytes,sourceFixture,addedFiles};
