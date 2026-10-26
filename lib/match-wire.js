// Shared browser/server pose protocol. Only authoritative poses cross this API;
// there is no velocity integration, extrapolation or client physics clock.
const MAGIC=0x43414431,HEADER=36,RECORD=32;
export function projectPoses(snapshot,bodyIds){
 const poses=new Float32Array(bodyIds.length*7);
 for(let i=0;i<bodyIds.length;i++){
  const b=snapshot.bodies[bodyIds[i]],values=b&&[...b.position,...b.quaternion];
  if(!values||values.length!==7||!values.every(Number.isFinite))throw Error('Invalid authoritative pose: '+bodyIds[i]);
  poses.set(values,i*7);
 }
 return poses;
}
export function encodePoses({poses,tick,time},previous,sequence){
 const full=!previous,changed=[];
 for(let i=0;i<poses.length/7;i++)if(full||poses.subarray(i*7,i*7+7).some((v,k)=>v!==previous.poses[i*7+k]))changed.push(i);
 const buffer=new ArrayBuffer(HEADER+changed.length*RECORD),v=new DataView(buffer);
 v.setUint32(0,MAGIC,true);v.setUint32(4,sequence,true);v.setUint32(8,previous?.sequence??0,true);v.setUint32(12,full?1:0,true);v.setFloat64(16,tick,true);v.setFloat64(24,time,true);v.setUint32(32,changed.length,true);
 for(let j=0;j<changed.length;j++){const i=changed[j],offset=HEADER+j*RECORD;v.setUint32(offset,i,true);for(let k=0;k<7;k++)v.setFloat32(offset+4+k*4,poses[i*7+k],true);}
 return buffer;
}
export class AuthoritativePoses{
 constructor(bodyIds){this.bodyIds=bodyIds;this.reset();}
 reset(){this.sequence=0;this.tick=-1;this.time=0;this.bodies=null;}
 accept(buffer){
  const v=new DataView(buffer);if(v.byteLength<HEADER||v.getUint32(0,true)!==MAGIC)throw Error('Invalid pose frame');
  const sequence=v.getUint32(4,true),base=v.getUint32(8,true),flags=v.getUint32(12,true),tick=v.getFloat64(16,true),time=v.getFloat64(24,true),count=v.getUint32(32,true);
  if(flags>1||!sequence||sequence<=this.sequence||!Number.isSafeInteger(tick)||tick<0||tick<this.tick||!Number.isFinite(time)||time<0||v.byteLength!==HEADER+count*RECORD)throw Error('Invalid pose sequence');
  if(flags===0&&(!this.bodies||base!==this.sequence))throw Error('Missing pose base');
  if(flags===1&&(base!==0||count!==this.bodyIds.length))throw Error('Incomplete pose keyframe');
  const next=flags===1?{}:{...this.bodies},seen=new Set();
  for(let j=0;j<count;j++){
   const offset=HEADER+j*RECORD,i=v.getUint32(offset,true),values=Array.from({length:7},(_,k)=>v.getFloat32(offset+4+k*4,true));
   if(i>=this.bodyIds.length||seen.has(i)||!values.every(Number.isFinite))throw Error('Invalid pose record');seen.add(i);
   next[this.bodyIds[i]]={position:values.slice(0,3),quaternion:values.slice(3)};
  }
  Object.assign(this,{sequence,tick,time,bodies:next});return {tick,time,bodies:next};
 }
}
export function validateDriverInput(value){
 if(!value||value.type!=='input'||Object.keys(value).some(k=>!['type','sequence','enabled','controllers'].includes(k))||!Number.isSafeInteger(value.sequence)||value.sequence<1||typeof value.enabled!=='boolean'||!Array.isArray(value.controllers)||value.controllers.length>2)throw Error('Invalid driver input');
 const seen=new Set();
 for(const c of value.controllers){
  if(!c||Object.keys(c).some(k=>!['port','axes','buttons','pov'].includes(k))||![0,1].includes(c.port)||seen.has(c.port)||!Array.isArray(c.axes)||c.axes.length!==6||!c.axes.every(v=>Number.isFinite(v)&&Math.abs(v)<=1)||!Number.isInteger(c.buttons)||c.buttons<0||c.buttons>1023||![-1,0,45,90,135,180,225,270,315].includes(c.pov))throw Error('Invalid controller');seen.add(c.port);
 }
 return value;
}
