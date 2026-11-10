const {test}=require('node:test'),assert=require('node:assert/strict');
test('preview status distinguishes static loading from live playback and offers retry without clearing the picture',()=>{
 const {view}=require('../../src/companion/sidebar-recovery.js'),state={observed:{applied:true},playback:{preview:true,state:'loading'}};
 assert.match(view(state).message,/靜態背景.*預載/);assert.equal(view(state).warning,false);const failed=view({...state,error:{code:'RENDERER_FAILED'}});assert.match(failed.message,/保留靜態/);assert.equal(failed.visible,true);assert.equal(failed.action,'reconnect');
});
const {view,create}=require('../../src/companion/sidebar-recovery.js');
const missing={observed:{applied:false},error:{code:'HOST_NEEDS_MANAGED_LAUNCH'}};
test('a disabled image switch is visible even when other appearance styles are applied',async()=>{
 const state={desired:{enabled:true,wallpaperEnabled:false},observed:{applied:true}};
 assert.equal(view(state).visible,true);assert.equal(view(state).label,'啟用桌布');assert.match(view(state).message,/背景開關/);
 const calls=[],controller=create({request:async(...args)=>{calls.push(args);return {state:{desired:{enabled:true,wallpaperEnabled:true},observed:{applied:true}}}},update(){}});
 controller.setState(state);assert.equal(calls.length,0);await controller.run();assert.deepEqual(calls,[['enable-wallpaper',{}]]);
 assert.match(view({desired:{enabled:false}}).message,/總開關/);
});
test('sidebar distinguishes pending exit, enabled preference and applied proof',()=>{
 assert.equal(view({...missing,desired:{enabled:true}}).action,'wait-for-exit-and-launch');
 assert.equal(view({...missing,pendingLaunch:true}).disabled,true);
 assert.match(view({...missing,pendingLaunch:true}).message,/正常完全退出/);
 assert.equal(view({observed:{applied:true}}).visible,false);
 assert.equal(view({phase:'disabled'}).message,'桌布已關閉。');
});
test('recovery dispatches once while busy and does not mutate preferences',async()=>{
 let finish,latest;const calls=[];
 const controller=create({request:(...args)=>{calls.push(args);return new Promise(r=>finish=r)},update:v=>latest=v});
 controller.setState(missing);const pending=controller.run();await controller.run();
 assert.equal(latest.disabled,true);assert.deepEqual(calls,[['wait-for-exit-and-launch',{hostId:'codex-desktop'}]]);
 finish({state:{...missing,pendingLaunch:true}});await pending;await controller.run();assert.equal(calls.length,1);
 assert.equal(latest.label,'等待正常退出');
});
test('failed reconnect remains retryable and does not expose raw exceptions',async()=>{
 let latest,count=0;const controller=create({request:async(action,payload)=>{assert.equal(action,'reconnect');assert.deepEqual(payload,{});if(++count===1)throw Error('secret');return {state:{observed:{applied:true}}}},update:v=>latest=v});
 controller.setState({error:{code:'RENDERER_FAILED'}});await controller.run();
 assert.match(latest.operationError,/操作未完成/);assert.doesNotMatch(latest.operationError,/secret/);assert.equal(latest.disabled,false);
 await controller.run();assert.equal(latest.visible,false);assert.equal(latest.operationError,'');
});
