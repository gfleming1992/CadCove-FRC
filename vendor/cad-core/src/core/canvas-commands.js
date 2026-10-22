// One interaction contract for all CAD hosts. Public distances are mm; angles
// are degrees for mechanisms and radians for cameras. Hosts adapt display scale.
import {resolveJoint} from './mechanism.js';
export const CANVAS_COMMANDS=['capabilities','state','selection','highlight','opacity','visibility','reveal','view','motion'];
export function createCanvasCommands({viewer,motion,selection,unitsPerMm=1,mode=()=> 'cad',revision=()=>null}){
 const camera=(c,scale)=>({...c,...(c.target?{target:c.target.map(v=>v*scale)}:{}),...(c.distance!==undefined?{distance:c.distance*scale}:{})});
 return function command(method,args={}, {nativeUnits=false}={}){
  if(method==='capabilities')return {version:1,commands:[...CANVAS_COMMANDS],units:{length:'mm',jointAngle:'deg',time:'s',cameraAngle:'rad'},mode:mode(),motion:mode()==='cad',beltSurfaces:true,sheetMetalFolds:true,stockRemoval:true,cutTools:['bit','laser']};
  if(method==='state')return {mode:mode(),camera:camera(viewer.camera,nativeUnits?1:1/unitsPerMm),selection:selection.state(),motion:motion.state()};
  if(method==='selection')return args.ids===undefined?selection.state():selection.set(args.ids);
  if(method==='opacity')return selection.opacity(args);
  if(method==='visibility')return selection.visibility(args);
  if(method==='highlight')return args.action==='state'?selection.state():selection.setHighlights(args.action==='clear'?[]:args.parts);
  if(method==='reveal')return args.action==='stop'?selection.stopReveal():args.action==='state'?selection.state():selection.startReveal(args);
  if(method==='view'){
   const scale=nativeUnits?1:unitsPerMm;
   const result=selection.view({...args,...(args.camera?{camera:camera(args.camera,scale)}:{}),...(args.pan?{pan:args.pan.map(v=>v*scale)}:{})});
   return {...result,camera:camera(result.camera,1/scale)};
  }
  if(method!=='motion')throw Error('Unsupported canvas command: '+method);
  if(mode()!=='cad')throw Error('Return to CAD motion mode before commanding trajectories; physics uses motor controls');
  if(args.action==='play-cut')return motion.playCut(args.solution,revision());
  if(args.action==='play-fold')return motion.playFold(args.solution,revision());
  if(args.action==='play-solved')return motion.playSolved(args.solution,revision());
  if(['pause','resume','stop','reset','state','seek'].includes(args.action)&&['solved','fold','cut'].includes(motion.playback?.kind))return args.action==='seek'?motion.seek(args.seconds):motion[args.action]();
  if(['solved','fold','cut'].includes(motion.playback?.kind)&&['rotate','move','animate','play'].includes(args.action))throw Error('Reset solved motion before issuing joint animation commands');
  if(args.action==='state')return motion.state();
  if(!motion.model)throw Error('No mechanism definition loaded');
  if(args.action==='list')return {joints:motion.model.joints,bodies:motion.model.bodies,relations:motion.model.relations,motors:motion.model.motors??[],beltSurfaces:motion.model.beltSurfaces??[]};
  if(args.action==='play')return motion.play(args.trajectory);
  if(args.action==='rotate')return motion.rotate(args.part,args.degrees);
  if(args.action==='move'){const joint=resolveJoint(motion.model,args.part);return motion.rotate(joint,motion.angles[joint]+args.degrees);}
  if(args.action==='animate')return motion.animate(args.part,args.rpm,args.seconds);
  if(args.action==='seek')return motion.seek(args.seconds);
  if(['pause','resume','stop','reset','state'].includes(args.action))return motion[args.action]();
  throw Error('Unknown motion action');
 };
}
