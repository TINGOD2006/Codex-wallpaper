const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {collectReleaseFiles,isReleaseFile,resetBuildDirectory}=require('../scripts/release-files.cjs');
const project=path.resolve(__dirname,'..');
test('release includes every runtime family and excludes local records and wallpaper selections',async()=>{
 const files=await collectReleaseFiles();
 for(const name of ['assets/boot-animation/startup.mp4','assets/boot-animation/DragonBoot.exe','assets/boot-animation/LICENSE','assets/native/CodexNativeActivation.dll','assets/webview2/WebView2Loader.dll','src/json-lines.cjs','src/boot-animation/app.manifest','scripts/install-integrated.ps1','plugins/codex-wallpaper-control/.codex-plugin/plugin.json','marketplace/.agents/plugins/marketplace.json','.github/workflows/ci.yml'])assert.ok(files.includes(name),name);
 assert.ok(!files.includes('scene.json'));
 for(const name of files)assert.equal(isReleaseFile(name),true,name);
 for(const name of ['assets/boot-animation/logs/launcher.log','.state/session.json','assets/private.pkg','runtime/manager.json','data/user-settings.json','.env.local','assets/x/../secret'])assert.equal(isReleaseFile(name),false,name);
});
test('build cleanup rejects source directories and linked outputs and removes stale generated files',async()=>{
 await assert.rejects(resetBuildDirectory(project),/generated/);await assert.rejects(resetBuildDirectory(path.join(project,'src')),/generated/);await assert.rejects(resetBuildDirectory(path.join(project,'dist')),/generated/);
 const root=path.join(project,'.state','release-test-'+randomUUID()),outside=path.join(root,'outside'),link=path.join(root,'link');await fs.mkdir(outside,{recursive:true});await fs.writeFile(path.join(outside,'keep.txt'),'keep');
 await fs.symlink(outside,link,'junction');await assert.rejects(resetBuildDirectory(path.join(link,'child')),/linked/);assert.equal(await fs.readFile(path.join(outside,'keep.txt'),'utf8'),'keep');
 const output=path.join(root,'output');await fs.mkdir(output);await fs.writeFile(path.join(output,'stale.log'),'stale');await resetBuildDirectory(output);assert.deepEqual(await fs.readdir(output),[]);
});
