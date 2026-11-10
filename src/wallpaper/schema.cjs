const template=require('../../wallpaper.defaults.json');
const ranges={opacity:[0,1],brightness:[.25,1.75],contrast:[.5,1.5],saturation:[0,2],blur:[0,24],scrim:[0,1],x:[0,100],y:[0,100],offsetX:[-2000,2000],offsetY:[-2000,2000],scale:[.5,3],alpha:[0,1],border:[0,.4],volume:[0,1],renderFps:[15,60],displayFps:[1,60],width:[320,1920],height:[240,1080],rotationSeconds:[30,86400]};
const integers=new Set(['renderFps','displayFps','width','height','rotationSeconds']);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const enums={fit:['cover','contain','stretch'],rendererMode:['auto','pool','isolated'],resolutionMode:['window','manual'],qualityMode:['fixed','balanced','low']};
const legacyTemplateV1=structuredClone(template);legacyTemplateV1.schemaVersion=1;delete legacyTemplateV1.performance;
function defaults(){return structuredClone(template)}
function upgradeSurfaces(value){
  const next=structuredClone(value);
  if(plain(next)&&next.schemaVersion===1&&plain(next.materials))for(const name of ['titlebar','panels','overlays'])if(!Object.hasOwn(next.materials,name))next.materials[name]=structuredClone(template.materials[name]);
  return next;
}
function validateAgainst(value,shape){
  function visit(v,t,key='root'){
    if(plain(t)){
      if(!plain(v)||Object.keys(v).length!==Object.keys(t).length||Object.keys(v).some(k=>!Object.hasOwn(t,k)))throw new Error(`Invalid settings object: ${key}`);
      for(const k of Object.keys(t))visit(v[k],t[k],k);return;
    }
    if(Array.isArray(t)){if(!Array.isArray(v)||v.length>10000||v.some(x=>typeof x!=='string'||!x.trim()||x.length>4096||x.includes('\0')))throw new Error(`Invalid settings list: ${key}`);return}
    if(t===null){if(v!==null&&(typeof v!=='string'||!v.trim()||v.length>256||v.includes('\0')))throw new Error(`Invalid ${key}`);if(key==='maskColor'&&v!==null&&!/^#[\da-f]{6}$/i.test(v))throw new Error('Invalid mask color');return}
    if(typeof v!==typeof t)throw new Error(`Invalid settings type: ${key}`);
    if(typeof t==='number'){
      if(!Number.isFinite(v)||(key==='schemaVersion'&&v!==t)||(ranges[key]&&(v<ranges[key][0]||v>ranges[key][1]))||(integers.has(key)&&!Number.isInteger(v)))throw new Error(`Invalid settings range: ${key}`);
    }
    if(typeof t==='string'){
      if(enums[key]){if(!enums[key].includes(v))throw new Error(`Invalid ${key}`)}
      else if(!/^#[\da-f]{6}$/i.test(v))throw new Error(`Invalid palette: ${key}`);
    }
  }
  visit(value,shape);return structuredClone(value);
}
function validateSettings(value){const settings=validateAgainst(value,template);settings.performance.qualityMode='fixed';return settings}
function upgradeSettings(value){const old=upgradeSurfaces(value);if(plain(old?.playback)&&[1,2].includes(old.schemaVersion)&&!Object.hasOwn(old.playback,'sceneLive'))old.playback.sceneLive=true;if(old?.schemaVersion===1){validateAgainst(old,legacyTemplateV1);return validateSettings({...old,schemaVersion:2,performance:{...template.performance,resolutionMode:'manual'}})}if(plain(old?.performance)&&!Object.hasOwn(old.performance,'powerSaving'))old.performance.powerSaving=false;return validateSettings(old)}
function mergeSettings(current,patch){
  const result=validateSettings(current);
  function merge(target,p,t){
    if(!plain(p)||Object.keys(p).some(k=>!Object.hasOwn(t,k)))throw new Error('Unknown settings field');
    for(const [k,v]of Object.entries(p)){if(plain(t[k]))merge(target[k],v,t[k]);else target[k]=structuredClone(v)}
  }
  merge(result,patch,template);return validateSettings(result);
}
module.exports={defaults,validateSettings,mergeSettings,upgradeSurfaces,upgradeSettings,ranges};
