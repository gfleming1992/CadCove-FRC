import {MechanismSession} from './mechanism-session.js';
import {compilePhysicalModel,validatePhysicalAssets} from './physical-model.js';
export async function preparePhysics(binary,model,{signal,onPhase=()=>{},onState=()=>{},assetRoot,requestTimeoutMs=120000}={}){
 const s=new MechanismSession(binary,{assetRoot,requestTimeoutMs,onState,onError:e=>{s.failure=e.message;}}),world=compilePhysicalModel(model);
 const abort=()=>s.close(Error('Physics build superseded'));signal?.addEventListener('abort',abort,{once:true});
 const close=s.close.bind(s);s.close=(...args)=>{signal?.removeEventListener('abort',abort);close(...args);};
 try{
  if(signal?.aborted)throw Error('Physics build superseded');
  const assets=await validatePhysicalAssets(world,{assetRoot});
  if(signal?.aborted)throw Error('Physics build superseded');
  await s.startWorld(world);const caps=await s.request({op:'capabilities'});if(!caps.features?.includes('physical-inertia-tensor-v1'))throw Error('Native runtime lacks physical-inertia-tensor-v1; rebuild/update runtime');onPhase('validating');
  // Bounded isolated smoke test catches native construction/step failures and
  // nonfinite states. It is not a claim of calibrated hardware accuracy.
  const result=await s.request({op:'step',steps:20,volts:{}}),snapshot=result.state??result;
  const check=v=>{if(typeof v==='number'&&!Number.isFinite(v))throw Error('Nonfinite physics state');if(v&&typeof v==='object')Object.values(v).forEach(check);};check(snapshot);
  for(const b of model.bodies){const pose=snapshot.bodies?.[b.id];for(const [key,size]of [['position',3],['quaternion',4],['velocity',3],['angular_velocity',3]])if(!Array.isArray(pose?.[key])||pose[key].length!==size||!pose[key].every(Number.isFinite))throw Error('Invalid body state in native validation: '+b.id);}
  for(const j of model.joints)if(!Number.isFinite(snapshot.joints?.[j.id]?.position)||!Number.isFinite(snapshot.joints?.[j.id]?.velocity))throw Error('Invalid joint state: '+j.id);
  s.state=await s.request({op:'load',world});
  s.checks={assets,construction:true,finiteState:true,smokeTicks:20,hardwareCalibrated:false,activation:'fresh isolated dependency component',assumptions:model.bodies.map(b=>({body:b.id,...b.provenance}))};
  return s;
 }catch(e){s.close();throw e;}
}
