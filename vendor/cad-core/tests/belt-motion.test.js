import {test,expect} from 'bun:test';
import {validateMechanism,mechanismPose} from '../src/core/mechanism.js';
import {BeltSurfaces,openBeltPath,sampleBeltPath} from '../src/core/belt-motion.js';
import {createCanvasCommands} from '../src/core/canvas-commands.js';
export function fixture(){
 const radius=10,pitch=2*Math.PI,centers=[[0,0,0],[50,0,0]],pulleys=centers.map(centerMm=>({centerMm,pitchRadiusMm:radius}));
 const model={schema:1,units:'mm-deg',bodies:[{id:'base',fixed:true,origin:[0,0,0],parts:['belt']},...centers.map((origin,i)=>({id:'b'+i,fixed:false,origin,parts:['p'+i]}))],joints:centers.map((origin,i)=>({id:'j'+i,type:'revolute',parent:'base',child:'b'+i,origin,axis:[0,0,1],bindAngleDeg:0})),relations:[{id:'drive',type:'belt',driver:'j0',follower:'j1',driverTeeth:10,followerTeeth:10,direction:1}],beltSurfaces:[{id:'belt',part:'belt',body:'base',relation:'drive',pitchMm:pitch,direction:-1,widthAxis:[0,0,1],pulleys}]};
 const path=openBeltPath(pulleys,[0,0,1]),positions=[],normals=[];
 for(let i=0;i<120;i++){const f=sampleBeltPath(path,path.length*i/120);positions.push(...f.point);normals.push(...f.normal);}
 return {model:validateMechanism(model),path,mesh:{id:'belt',positions:new Float32Array(positions),normals:new Float32Array(normals),indices:new Uint32Array(Array.from({length:120},(_,i)=>i))}};
}
test('existing vertices follow the loop, reverse and return exactly without mutating CAD',()=>{
 const {model,path,mesh}=fixture(),original=mesh.positions.slice(),b=new BeltSurfaces(model,{parts:[mesh]});
 const at=b.evaluate({'j0':-90});const wanted=sampleBeltPath(path,Math.PI*5);
 for(let k=0;k<3;k++)expect(at.belt.positions[k]).toBeCloseTo(wanted.point[k],5);
 const forward=at.belt.positions.slice();b.evaluate({'j0':90});expect(Array.from(at.belt.positions)).not.toEqual(Array.from(forward));
 b.evaluate({'j0':0});expect(Array.from(at.belt.positions)).toEqual(Array.from(original));expect(Array.from(mesh.positions)).toEqual(Array.from(original));
 expect(b.evaluate({'j0':0})).toEqual({});
});
test('path frames join continuously around unequal pulleys and wrap',()=>{
 const path=openBeltPath([{centerMm:[0,0,0],pitchRadiusMm:10},{centerMm:[70,0,0],pitchRadiusMm:20}],[0,0,1]);
 for(const s of path.segments){const a=sampleBeltPath(path,s.start+1e-7),b=sampleBeltPath(path,s.start-1e-7);for(let k=0;k<3;k++){expect(a.point[k]).toBeCloseTo(b.point[k],5);expect(a.tangent[k]).toBeCloseTo(b.tangent[k],5);}}
 expect(sampleBeltPath(path,0)).toEqual(sampleBeltPath(path,path.length));
});
test('reject bad ownership, radii, axes, ratio and impossible paths before motion',()=>{
 for(const mutate of [m=>m.beltSurfaces[0].part='p0',m=>m.beltSurfaces[0].pulleys[0].pitchRadiusMm=9,m=>m.beltSurfaces[0].widthAxis=[0,0,2],m=>m.beltSurfaces[0].pulleys[1].centerMm=[5,0,0],m=>m.beltSurfaces[0].toothCount=5]){const {model}=fixture();mutate(model);expect(()=>validateMechanism(model)).toThrow();}
});
test('belt deformation stays in assembled coordinates and moving parent carries it once',()=>{
 const {model,mesh}=fixture();model.bodies.unshift({id:'world',fixed:true,origin:[0,0,0],parts:['world']});model.bodies.find(b=>b.id==='base').fixed=false;model.joints.push({id:'parent',type:'revolute',parent:'world',child:'base',origin:[0,0,0],axis:[0,1,0],bindAngleDeg:0});
 const m=validateMechanism(model),pose=mechanismPose(m,'parent',90),b=new BeltSurfaces(m,{parts:[mesh]});const q=b.evaluate(pose.angles).belt.positions;expect(Array.from(q)).toEqual(Array.from(mesh.positions));expect(pose.transforms.belt[0]).toBeCloseTo(0,8);
});
test('shared camera commands have identical mm contract in both viewer scales',()=>{
 for(const scale of [1,.001]){const viewer={camera:{target:[0,0,0],distance:10*scale,yaw:1,pitch:1}};const selection={view:opts=>{if(opts.camera)viewer.camera={...viewer.camera,...opts.camera};if(opts.pan)viewer.camera.target=viewer.camera.target.map((v,i)=>v+opts.pan[i]);return {camera:viewer.camera};},state:()=>({})};const c=createCanvasCommands({viewer,selection,motion:{state:()=>({})},unitsPerMm:scale});expect(c('view',{camera:{target:[100,200,300],distance:500}}).camera.distance).toBe(500);expect(viewer.camera.distance).toBe(500*scale);expect(c('view',{pan:[10,0,0]}).camera.target).toEqual([110,200,300]);expect(c('capabilities').units.length).toBe('mm');}
});
