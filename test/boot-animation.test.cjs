const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('packaged animation is passive, preserves host geometry during playback, has no executable launch path and retains upstream notices',()=>{
 const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'src/boot-animation/DragonCodexBoot.cs'),'utf8'),config=JSON.parse(fs.readFileSync(path.join(root,'assets/boot-animation/launcher.json')));
 for(const name of ['AutoReplaceEntrypoints','ScanAllLocalDrives','MatchClientToPlayer'])assert.equal(config[name],false);
 assert.doesNotMatch(source,/Process\.Start\s*\(|LaunchApp\s*\(|Integrate\s*\(/);assert.match(source,/Passive player cannot launch apps/);assert.match(source,/state\.HostPid/);assert.match(source,/state\.HostStartTime/);assert.match(source,/state\.HostPath/);
 assert.ok(fs.statSync(path.join(root,'assets/boot-animation/startup.mp4')).size>1000000);assert.match(fs.readFileSync(path.join(root,'assets/boot-animation/LICENSE'),'utf8'),/MIT License/);assert.ok(fs.existsSync(path.join(root,'assets/boot-animation/MEDIA_NOTICE.md')));
});
