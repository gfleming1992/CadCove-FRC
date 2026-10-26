// Presentation-only preparation. Particle frames are immutable SI-coordinate
// snapshots from physics; neither this helper nor the renderer simulates foam.
const isArray = value => Array.isArray(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView));
export function checkedTopology(topology) {
 const count=topology?.surfaceVertexCount, input=topology?.indices;
 if(!Number.isInteger(count)||count<3||count>1_000_000)throw Error('Expected 3–1000000 surface vertices');
 if(!isArray(input)||!input.length||input.length%3||input.length>6_000_000)throw Error('Expected triangle topology');
 if(Array.from(input).some(i=>!Number.isInteger(i)||i<0||i>=count))throw Error('Triangle index outside surface vertices');
 const center=topology.centerParticleIndex;
 if(center!==undefined&&(!Number.isInteger(center)||center<count||center>1_000_000))throw Error('Center particle must follow surface vertices');
 const particleCount=topology.particleCount??(center===undefined?count:center+1);
 if(!Number.isInteger(particleCount)||particleCount<count||particleCount>1_000_001||(center!==undefined&&center>=particleCount))throw Error('Invalid particle count');
 const indices=new Uint32Array(input), counts=new Uint32Array(count);
 for(const i of indices)counts[i]++;
 if(counts.some(n=>n===0))throw Error('Every surface vertex needs a triangle');
 const offsets=new Uint32Array(count+1);
 for(let i=0;i<count;i++)offsets[i+1]=offsets[i]+counts[i];
 const faces=new Uint32Array(indices.length), cursors=offsets.slice();
 for(let t=0;t<indices.length/3;t++)for(let k=0;k<3;k++)faces[cursors[indices[t*3+k]]++]=t;
 return {surfaceVertexCount:count,particleCount,centerParticleIndex:center,indices,offsets,faces};
}
export function checkedCoordinates(particles, particleCount, {scale=1000,offsetMm=[0,0,0]}={}) {
 if(!isArray(particles))throw Error('Expected particle positions');
 const nested=Array.isArray(particles)&&isArray(particles[0]);
 if(particles.length!==(nested?particleCount:particleCount*3))throw Error('Particle count does not match topology');
 if(!Number.isFinite(scale)||!Number.isFinite(Math.fround(scale))||Math.fround(scale)<=0||!isArray(offsetMm)||offsetMm.length!==3||!Array.from(offsetMm).every(n=>Number.isFinite(n)&&Number.isFinite(Math.fround(n))))throw Error('Invalid particle coordinate conversion');
 const data=new Float32Array(particleCount*3),low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<particleCount;i++){
  if(nested&&(!isArray(particles[i])||particles[i].length!==3))throw Error('Expected xyz particle positions');
  for(let k=0;k<3;k++){
   const value=nested?particles[i][k]:particles[i*3+k],converted=value*scale+offsetMm[k];
   if(typeof value!=='number'||!Number.isFinite(value)||!Number.isFinite(converted)||Math.abs(converted)>1e9)throw Error('Particle coordinate is nonfinite or exceeds presentation range');
   data[i*3+k]=value;
   if(!Number.isFinite(data[i*3+k]))throw Error('Particle coordinate exceeds Float32 range');
   low[k]=Math.min(low[k],converted);high[k]=Math.max(high[k],converted);
  }
 }
 return {data,bounds:{low,high},sourceLength:particles.length};
}
export function createDeformationPrototype(id,topology,particles,color='#e9bd48',options={}) {
 const t=checkedTopology(topology),p=checkedCoordinates(particles,t.particleCount,options),scale=options.scale??1000,offset=options.offsetMm??[0,0,0];
 const positions=new Float32Array(t.surfaceVertexCount*3),normals=new Float32Array(positions.length);
 for(let i=0;i<positions.length;i++){positions[i]=p.data[i]*scale+offset[i%3];normals[i]=i%3===2?1:0;}
 return {id,name:id,color,positions,normals,indices:t.indices};
}
