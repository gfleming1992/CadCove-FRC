// Release/development fixture builder. Runtime users consume generated artifacts;
// this is not a generic CAD-to-mechanism inference engine.
import path from 'node:path';
import {readFile,mkdir,cp,writeFile,lstat,mkdtemp,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {OcctKernel} from 'occt-wasm';
import * as brep from 'brepjs';
import {encodeScene} from '../vendor/cad-core/src/core/mesh.js';
import {identity,translation} from '../lib/transforms.js';
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--output')throw Error('Usage: bun scripts/build-training-example.js --output NEW_WORKSPACE');
const root=path.resolve(import.meta.dir,'..'),output=path.resolve(args[1]);
try{await lstat(output);throw Error('Example output must be a new directory');}catch(e){if(e.code!=='ENOENT')throw e;}
await mkdir(output,{recursive:true});
const write=async(file,data)=>{await mkdir(path.dirname(path.join(output,file)),{recursive:true});await writeFile(path.join(output,file),typeof data==='string'?data:JSON.stringify(data,null,2)+'\n');};
const hash=b=>createHash('sha256').update(b).digest('hex');
const helperRoot=path.join(root,'examples/training-robot/vendor/limelight');
const helperPin=JSON.parse(await readFile(path.join(helperRoot,'upstream.json'),'utf8'));
for(const [file,expected] of Object.entries(helperPin.files))if(hash(await readFile(path.join(helperRoot,file)))!==expected)throw Error('Pinned Limelight helper changed: '+file);
await cp(path.join(root,'examples/training-robot'),output,{recursive:true});
await cp(path.join(root,'examples/season-plugin/src'),path.join(output,'src'),{recursive:true});
// Load geometry and physics parameters from the exact private source snapshot
// we fingerprint and export. Imports from the live checkout could otherwise
// execute one revision while a subsequent copy recorded another revision.
const sourceFiles=await Promise.all(['model.js','design.js','components.js'].map(async name=>({name,bytes:await readFile(path.join(output,'cad',name))})));
await mkdir(path.join(root,'build'),{recursive:true});
const snapshot=await mkdtemp(path.join(root,'build','.training-cad-'));let modules;
try{
 for(const {name,bytes} of sourceFiles)await writeFile(path.join(snapshot,name),bytes);
 modules=await Promise.all(['model.js','design.js','components.js'].map(name=>import(pathToFileURL(path.join(snapshot,name)).href)));
}finally{await rm(snapshot,{recursive:true,force:true});}
const [{default:model,field},{robotParts,fieldParts,wheels},{krakenX60,limelight}]=modules;
const sourceInputs={schema:1,files:sourceFiles.map(({name,bytes})=>({file:'cad/'+name,sha256:hash(bytes)}))};
const kernel=await OcctKernel.init({wasm:await readFile(path.join(root,'node_modules/occt-wasm/dist/occt-wasm.wasm'))});
const adapter=brep.OcctWasmAdapter.fromKernel(kernel);brep.registerKernel('occt-wasm',adapter);
const hashes={};
try{
 for(const [kind,build] of [['robot',model],['field',field]]){
  const parts=build(),instances=[],catalog={};
  hashes[kind]=hash(Buffer.concat(['design.js','model.js'].map(name=>sourceFiles.find(f=>f.name===name).bytes)));
  for(const part of parts){
   const mesh=adapter.mesh(part.shape.wrapped,{tolerance:.5,angularTolerance:.4});
   const positions=new Float32Array(mesh.vertices),normals=new Float32Array(mesh.normals),indices=new Uint32Array(mesh.triangles);
   const metrics={valid:adapter.isValid(part.shape.wrapped),bounds:adapter.boundingBox(part.shape.wrapped),triangles:indices.length/3};
   if(!metrics.valid)throw Error('Invalid example CAD '+part.id);
   const bytes=encodeScene({parts:[{...part,shape:undefined,positions,normals,indices,metrics}]});
   const file='meshes/'+part.id+'.bin';await mkdir(path.join(output,'build/cadcove',kind,'meshes'),{recursive:true});await writeFile(path.join(output,'build/cadcove',kind,file),new Uint8Array(bytes));
   catalog[part.id]={mesh:file,meshSha256:hash(new Uint8Array(bytes)),bounds:metrics.bounds};
   instances.push({id:part.id,name:part.name,asset:part.id,color:part.color,transform:identity()});
  }
  await write('build/cadcove/'+kind+'/catalog.json',catalog);await write('build/cadcove/'+kind+'/instances.json',instances);
  await write('build/cadcove/'+kind+'/assembly.json',{schema:1,id:kind,units:'mm',sourceHash:hashes[kind]});
 }
}finally{kernel[Symbol.dispose]();}
const frame=robotParts.find(p=>p.id==='frame'),tray=robotParts.find(p=>p.id==='lift-tray');
const chassis=frame.position,lift=tray.position;
const body=(id,position,size,mass,fixed=false)=>({id,position,mass,fixed,colliders:[{kind:'box',half:size.map(v=>v/2)}]});
const world={dt:.005,solver_iterations:8,bodies:[
 body('chassis',chassis,frame.size,29),body('lift',lift,tray.size,3),
 ...wheels.map(w=>({id:w.id,position:w.position,mass:w.mass,friction:.9,colliders:[{kind:'cylinder',radius:w.radius,half_height:w.width/2}]})),
 ...fieldParts.filter(p=>p.body).map(p=>body(p.body,p.position,p.size,1,true)),
],joints:[
 ...wheels.map(w=>({id:w.id+'-axis',parent:'chassis',child:w.id,kind:'revolute',axis:[0,1,0],anchor_parent:w.position.map((v,i)=>v-chassis[i]),anchor_child:[0,0,0]})),
 {id:'lift-axis',parent:'chassis',child:'lift',kind:'prismatic',axis:[0,0,1],anchor_parent:lift.map((v,i)=>v-chassis[i]),anchor_child:[0,0,0],limits:[0,.5]},
],motors:[],season:{schema:1,adapter:'example.training-zone',config:{schema:1,bodies:['chassis'],goalX:2,duration:15}}};
for(const joint of world.joints)world.motors.push({id:joint.id.replace('-axis','-motor'),joint:joint.id,...krakenX60,rotor_per_unit:joint.id==='lift-axis'?160:8,efficiency:.85});
world.vision={seed:2026,tagSizeMetres:.1651,cameras:[limelight]};
world.field_tags={tags:fieldParts.filter(p=>p.id.startsWith('tag-')).map((p,i)=>({id:i+1,position:p.position,referencePosition:p.position,quaternion:[0,0,1,0]}))};
const worldText=JSON.stringify(world,null,2)+'\n';await write('build/cadcove/world.json',worldText);
const robotBindings=Object.fromEntries(robotParts.map(p=>[p.id,{body:p.body,local:translation(world.bodies.find(b=>b.id===p.body).position.map(v=>-v))}]));
await write('build/cadcove/scene-bindings.json',{schema:1,worldHash:hash(worldText),sourceHash:hashes.robot,fieldSourceHash:hashes.field,sourceInputs,start:[0,0,0],fieldOrigin:[0,0,0],robot:robotBindings,field:{}});
await write('training-profile.json',{schema:1,id:'training-robot',name:'CadCove training robot',cad:{robot:'build/cadcove/robot',field:'build/cadcove/field'},build:'build/cadcove',runtime:{adapter:'wpilib-java-phoenix6',clock:'physics',project:'.',jar:'build/libs/robot.jar',nativeLibraries:'build/jni/release'},practiceInput:{driverPort:0},practiceControls:[],calibration:[
 {subject:'CAD geometry and occurrence bindings',status:'derived',evidence:'Original analytic teaching design; CAD and colliders use dimensions from cad/design.js.'},
 ...['Motor ratios and frame directions','Mass, inertia and center of gravity','Tire, fuel and mechanism contact behavior','Complete mechanism articulation and sensors','Full-match hardware comparison'].map(subject=>({subject,status:'estimated',evidence:'Synthetic teaching example, not calibrated to hardware. Review cad/design.js and generated world before adapting.'})),
]});
console.log(JSON.stringify({ok:true,workspace:output,robotParts:robotParts.length,fieldParts:fieldParts.length,motors:world.motors.length,requiresBridgeExportAndGradleBuild:true,hardwareQualified:false}));
