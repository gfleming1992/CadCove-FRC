// Project-defined virtual Xbox controls. No team or mechanism semantics here.
export function validatePracticeControls(actions=[]){
 if(!Array.isArray(actions)||actions.length>24)throw Error('Invalid practice controls');
 const ids=new Set();
 for(const a of actions){
  if(!a||typeof a.id!=='string'||!a.id||ids.has(a.id)||typeof a.label!=='string'||!a.label||!['pulse','hold'].includes(a.kind))throw Error('Invalid practice action');
  ids.add(a.id);const b=a.binding;
  if(!b||![0,1].includes(b.port)||Number(b.button!==undefined)+Number(b.axis!==undefined)!==1)throw Error('Invalid controller binding');
  if(b.button!==undefined&&(!Number.isInteger(b.button)||b.button<1||b.button>10))throw Error('Invalid controller button');
  if(b.axis!==undefined&&(![2,3].includes(b.axis)))throw Error('Expected a controller trigger axis');
  if(a.allowedStates!==undefined&&(!Array.isArray(a.allowedStates)||a.allowedStates.some(s=>typeof s!=='string')))throw Error('Invalid action state gate');
 }
 return actions;
}
export class PracticeControls {
 constructor(actions=[]){this.actions=validatePracticeControls(actions);this.active=new Map();}
 clear(){this.active.clear();}
 press(id,time){
  const action=this.actions.find(a=>a.id===id);if(!action)throw Error('Unknown practice action');
  if(action.group)for(const a of this.actions)if(a.group===action.group)this.active.delete(a.id);
  // Pulse length is in simulation time, so slow physics still observes the edge.
  this.active.set(id,action.kind==='pulse'?time+.12:Infinity);
 }
 release(id){if(this.actions.find(a=>a.id===id)?.kind==='hold')this.active.delete(id);}
 merge(controllers,time,state){
  const result=controllers.map(c=>({...c,axes:[...c.axes]}));
  for(const [id,until] of this.active){
   const a=this.actions.find(a=>a.id===id);
   if(time>=until||a.allowedStates&&!a.allowedStates.includes(state)){this.active.delete(id);continue;}
   let c=result.find(c=>c.port===a.binding.port);
   if(!c){c={port:a.binding.port,axes:[0,0,0,0,0,0],buttons:0,pov:-1};result.push(c);}
   if(a.binding.button)c.buttons=(c.buttons||0)|(1<<(a.binding.button-1));
   else c.axes[a.binding.axis]=1;
  }
  return result;
 }
}
