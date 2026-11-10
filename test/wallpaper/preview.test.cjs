const {test}=require('node:test'),assert=require('node:assert/strict');
const {WallpaperController}=require('../../src/wallpaper/controller.cjs'),{defaults}=require('../../src/wallpaper/schema.cjs');
test('preview patches remain unsaved until the coalesced commit',async()=>{
 let saved=defaults(),writes=0;const c=new WallpaperController({store:{load:async()=>saved,save:async s=>{saved=structuredClone(s);writes++}},library:{get:()=>null},host:{apply:async()=>{},restoreAll:async()=>{},clearBackground:async()=>{}}});
 try{await c.start();writes=0;await c.patch({reading:{scrim:.6}},{persist:false});assert.equal(writes,0);assert.equal(c.snapshot().dirty,true);assert.equal(saved.reading.scrim,.84);await c.patch({});assert.equal(writes,1);assert.equal(saved.reading.scrim,.6)}finally{await c.close()}
});
