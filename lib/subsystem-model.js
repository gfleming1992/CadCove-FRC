// CAD assembly hierarchy and mechanical ownership are independent graphs.
// This resolver only reads supplied data; it never hides parts or starts physics.
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const list=(x,label)=>{if(x===undefined)return [];if(!Array.isArray(x))throw Error(label+' must be an array');return x;};
const strings=(x,label)=>{const a=list(x,label);if(a.some(v=>typeof v!=='string'||!v.trim())||new Set(a).size!==a.length)throw Error(label+' requires unique nonempty IDs');return a;};
const sorted=s=>[...s].sort();
function index(values,label){const map=new Map();for(const v of list(values,label)){if(!object(v)||typeof v.id!=='string'||!v.id.trim()||map.has(v.id))throw Error('Invalid or duplicate '+label+' ID');map.set(v.id,v);}return map;}
function ref(map,id,label){if(!map.has(id))throw Error('Unknown '+label+': '+id);return map.get(id);}
function acyclic(map,edges,label){const visiting=new Set(),done=new Set();function walk(id){if(visiting.has(id))throw Error(label+' cycle at '+id);if(done.has(id))return;visiting.add(id);for(const next of edges(map.get(id))) {ref(map,next,label);walk(next);}visiting.delete(id);done.add(id);}for(const id of map.keys())walk(id);}

/** Index native STEP assembly.json or an authored CadQuery hierarchy.
 * trees: [{id,kind:'step'|'cadquery'|'mixed',root:{id,children?:[],...}}].
 * Leaf IDs are stable rendered occurrence IDs, never asset/prototype IDs or names.
 */
export function indexAssemblyTrees(trees){
 const nodes=new Map(),leaves=new Set(),sources=new Map();
 for(const tree of list(trees,'trees')){
  if(!object(tree)||typeof tree.id!=='string'||!['step','cadquery','mixed'].includes(tree.kind)||sources.has(tree.id))throw Error('Invalid or duplicate tree descriptor');
  sources.set(tree.id,tree);const stack=new Set();
  function visit(node,parent){
   if(!object(node)||typeof node.id!=='string'||!node.id.trim())throw Error('Assembly node requires stable ID');
   if(stack.has(node))throw Error('Assembly cycle at '+node.id);
   if(nodes.has(node.id))throw Error('Duplicate assembly/occurrence ID: '+node.id);
   const children=list(node.children,'children of '+node.id);stack.add(node);
   nodes.set(node.id,{id:node.id,name:node.name??node.id,tree:tree.id,parent,children:children.map(c=>c.id),leaf:children.length===0});
   if(!children.length)leaves.add(node.id);
   for(const child of children)visit(child,node.id);stack.delete(node);
  }
  visit(tree.root,null);
 }
 return {nodes,leaves,sources};
}

function selectors(value,label,tree){
 if(value===undefined)return [];
 if(!object(value))throw Error(label+' must contain assemblies and/or occurrences');
 for(const key of Object.keys(value))if(!['assemblies','occurrences'].includes(key))throw Error('Unknown selector key: '+key);
 const found=new Set();
 function descend(id){const n=ref(tree.nodes,id,'assembly/occurrence');if(n.leaf)found.add(id);else n.children.forEach(descend);}
 for(const id of strings(value.assemblies,label+'.assemblies')){const n=ref(tree.nodes,id,'assembly');if(n.leaf)throw Error('Expected assembly, got occurrence: '+id);descend(id);}
 for(const id of strings(value.occurrences,label+'.occurrences')){const n=ref(tree.nodes,id,'occurrence');if(!n.leaf)throw Error('Expected occurrence, got assembly: '+id);found.add(id);}
 return sorted(found);
}

/** Resolve an authored subsystem and dependency closure. Unknown source references
 * throw; explicitly expected missing physical definitions become report issues.
 * Does not assert solver readiness or calibration; downstream compiler/validation
 * must still succeed. Callers must not use physics.complete as a safety certificate.
 */
export function resolveSubsystem(manifest,id,context={}){
 if(!object(manifest)||manifest.schema!==1)throw Error('Unsupported subsystem manifest schema');
 const tree=indexAssemblyTrees(context.trees),subs=index(manifest.subsystems,'subsystem');
 acyclic(subs,s=>strings(s.dependencies,'subsystem dependencies'),'subsystem dependency');
 if(manifest.sourceRevision!==undefined&&manifest.sourceRevision!==context.sourceRevision)throw Error('Stale subsystem source revision');
 for(const [treeId,pin] of Object.entries(manifest.treeRevisions??{})){const t=ref(tree.sources,treeId,'tree');if(typeof pin!=='string'||t.revision!==pin)throw Error('Stale subsystem tree revision: '+treeId);}
 const supplied=context.mechanism??{},isPhysical=!!supplied.physical||supplied.units==='m-kg-s-rad',def=supplied.physical??supplied, bodies=index(def.bodies??[],'body'), joints=index(def.joints??[],'joint'), motors=index(def.motors??[],'motor'), transmissions=index(def.transmissions??def.relations??[],'transmission');
 // Reject ambiguous CAD ownership and dangling mechanical edges before resolution.
 const ownership=new Map();
 for(const b of bodies.values())for(const p of strings(b.parts,'body parts')){if(!tree.leaves.has(p))throw Error('Stale body occurrence: '+p);if(ownership.has(p))throw Error('Multiple body owners: '+p);ownership.set(p,b.id);}
 for(const j of joints.values()){ref(bodies,j.parent,'joint parent body');ref(bodies,j.child,'joint child body');if(j.parent===j.child)throw Error('Joint connects body to itself: '+j.id);}
 const parents=new Map([...bodies.keys()].map(id=>[id,[]]));for(const j of joints.values())parents.get(j.child).push(j.parent);
 // Legacy rotary motion relies on a parent hierarchy. Explicit SI physical
 // graphs may have closed kinematic loops, validated by the native solver.
 if(!isPhysical)acyclic(bodies,b=>parents.get(b.id),'joint body');
 for(const t of transmissions.values()){ref(joints,t.driver,'transmission driver joint');ref(joints,t.follower,'transmission follower joint');if(t.driver===t.follower)throw Error('Self transmission: '+t.id);}
 // Transmission cycles are legitimate closed mechanical loops, not hierarchy cycles.
 for(const m of motors.values())ref(joints,m.joint,'motor joint');
 const rendered=context.parts===undefined?null:new Set(context.parts.map(p=>typeof p==='string'?p:p.id));
 const closure=new Set();function depend(key){const s=ref(subs,key,'subsystem');if(closure.has(key))return;for(const d of s.dependencies??[])depend(d);closure.add(key);}depend(id);
 const selected=new Set(),supports=new Set(),excluded=new Set(),bodyIds=new Set(),jointIds=new Set(),motorIds=new Set(),transmissionIds=new Set(),boundaryMap=new Map(),issues=[],requirements=[];
 const addIssue=(code,detail)=>issues.push({code,...detail});
 for(const key of closure){
  const s=subs.get(key);
  for(const occurrence of selectors(s.roots,'roots',tree).concat(selectors(s.include,'include',tree)))selected.add(occurrence);
  for(const occurrence of selectors(s.stationarySupports,'stationarySupports',tree)){selected.add(occurrence);supports.add(occurrence);}
  for(const occurrence of selectors(s.exclude,'exclude',tree))excluded.add(occurrence);
  const mechanical=s.mechanical??{};if(!object(mechanical))throw Error('mechanical must be an object');
  for(const k of Object.keys(mechanical))if(!['bodies','joints','motors','transmissions'].includes(k))throw Error('Unknown mechanical relationship: '+k);
  for(const [kind,map,target] of [['bodies',bodies,bodyIds],['joints',joints,jointIds],['motors',motors,motorIds],['transmissions',transmissions,transmissionIds]])for(const n of strings(mechanical[kind],kind)){ref(map,n,kind);target.add(n);}
  for(const boundary of list(s.boundaries,'boundaries')){
   if(!object(boundary)||!['fixed','external'].includes(boundary.mode)||typeof boundary.reason!=='string'||!boundary.reason.trim())throw Error('Boundary needs body, mode and reason');ref(bodies,boundary.body,'boundary body');
   if(boundaryMap.has(boundary.body)&&boundaryMap.get(boundary.body).mode!==boundary.mode)throw Error('Conflicting boundary: '+boundary.body);
   boundaryMap.set(boundary.body,boundary);
  }
  if(s.requirements!==undefined&&!object(s.requirements))throw Error('requirements must be an object');
  requirements.push({subsystem:key,...s.requirements});
  if(!s.provenance||typeof s.provenance.evidence!=='string'||!s.provenance.evidence.trim()||!['measured','derived','estimated','unknown'].includes(s.provenance.status))addIssue('missing-subsystem-provenance',{subsystem:key});
 }
 // Infer ownership of selected moving occurrences, but never expand an entire
 // fixed chassis just because a stationary support belongs to it.
 for(const p of selected){const b=bodies.get(ownership.get(p));if(b&&!b.fixed&&!supports.has(p)&&!boundaryMap.has(b.id))bodyIds.add(b.id);}
 let changed=true;while(changed){const n=bodyIds.size+jointIds.size+motorIds.size+transmissionIds.size;
  for(const id of motorIds)jointIds.add(motors.get(id).joint);
  for(const id of transmissionIds){const t=transmissions.get(id);jointIds.add(t.driver);jointIds.add(t.follower);}
  for(const j of joints.values())if(bodyIds.has(j.child)||jointIds.has(j.id)){jointIds.add(j.id);bodyIds.add(j.child);if(!boundaryMap.has(j.parent))bodyIds.add(j.parent);}
  for(const t of transmissions.values())if(jointIds.has(t.driver)||jointIds.has(t.follower)){transmissionIds.add(t.id);jointIds.add(t.driver);jointIds.add(t.follower);}
  for(const m of motors.values())if(jointIds.has(m.joint))motorIds.add(m.id);
  changed=n!==bodyIds.size+jointIds.size+motorIds.size+transmissionIds.size;
 }
 // External boundary bodies are dependencies, but not implicitly whole-robot selections.
 for(const bid of bodyIds){const b=bodies.get(bid);if(!b.fixed&&!boundaryMap.has(bid))for(const p of b.parts??[])selected.add(p);}
 for(const p of excluded)selected.delete(p);
 for(const p of selected){if(rendered&&!rendered.has(p))throw Error('Stale rendered occurrence: '+p);if(!ownership.has(p))addIssue('unbound-occurrence',{occurrence:p});}
 const usedBoundaries=new Set([...jointIds].flatMap(id=>[joints.get(id).parent,joints.get(id).child]).filter(id=>boundaryMap.has(id)));
 const selectedBodies=new Set([...bodyIds,...usedBoundaries,...[...supports].map(p=>ownership.get(p)).filter(Boolean)]);
 for(const bid of selectedBodies){
  const b=bodies.get(bid),boundary=boundaryMap.get(bid);
  if(boundary?.mode==='external')addIssue('external-boundary',{body:bid});
  for(const p of b.parts??[])if(excluded.has(p)&&!supports.has(p))addIssue('excluded-mechanical-occurrence',{body:bid,occurrence:p});
  const p=b.physics,si=b.inertial,finite=n=>typeof n==='number'&&Number.isFinite(n),vec=(v,n)=>Array.isArray(v)&&v.length===n&&v.every(finite);
  const mass=si?.mass??p?.massKg, inertia=si?.tensor??p?.principalInertiaKgMm2, center=si?.center??p?.centerOfMassMm;
  if(!finite(mass)||mass<=0||!vec(center,3)||!vec(inertia,si?6:3)||inertia.slice(0,3).some(n=>n<=0))addIssue('missing-inertial-properties',{body:bid});
  const evidence=b.provenance?.evidence??p?.provenance;if(typeof evidence!=='string'||!evidence.trim())addIssue('missing-body-provenance',{body:bid});
 }
 const finite=n=>typeof n==='number'&&Number.isFinite(n);
 for(const id of jointIds){const j=joints.get(id);if(!finite(j.damping)||j.damping<0)addIssue('missing-joint-damping',{joint:id});}
 for(const id of motorIds){const m=motors.get(id),p=m.physics??m;const fields=['rotorPerUnit','efficiency','resistance','torqueConstant','velocityConstant','currentLimit'];if(fields.some(k=>!finite(p[k])||(k==='rotorPerUnit'&&isPhysical?p[k]===0:p[k]<=0))||p.efficiency>1)addIssue('missing-motor-physics',{motor:id});}
 for(const id of transmissionIds){const t=transmissions.get(id),p=t.physics??t;if(['stiffness','damping','maxEffort'].some(k=>!finite(p[k])||p[k]<0)||!p.stiffness||!p.maxEffort)addIssue('missing-transmission-physics',{transmission:id});}
 const materialIds=new Set(),expectedBodies=new Set(),contactBodies=new Set();
 for(const r of requirements){
  for(const [field,map,label,target] of [['expectedJoints',joints,'joint',jointIds],['expectedMotors',motors,'motor',motorIds],['expectedTransmissions',transmissions,'transmission',transmissionIds]])for(const id of strings(r[field],field)){if(!map.has(id))addIssue('missing-expected-'+label,{[label]:id,subsystem:r.subsystem});else if(!target.has(id))addIssue('expected-'+label+'-outside-selection',{[label]:id,subsystem:r.subsystem});}
  for(const b of strings(r.expectedBodies,'expectedBodies')){expectedBodies.add(b);if(!bodies.has(b))addIssue('missing-expected-body',{body:b,subsystem:r.subsystem});else if(!bodyIds.has(b)&&!boundaryMap.has(b))addIssue('expected-body-outside-selection',{body:b,subsystem:r.subsystem});}
  for(const b of strings(r.contactBodies,'contactBodies')){contactBodies.add(b);if(!bodies.has(b))addIssue('missing-contact-body',{body:b});else{const v=bodies.get(b),p=v.physics,c=v.collision,shapes=c?.shapes??p?.colliders,friction=c?.friction??p?.friction;if(!Array.isArray(shapes)||!shapes.length||c?.disabled||p?.collisionModel==='none')addIssue('missing-contact-shapes',{body:b});if(typeof friction!=='number'||!Number.isFinite(friction)||friction<0)addIssue('missing-contact-friction',{body:b});if(!bodyIds.has(b)&&!boundaryMap.has(b))addIssue('contact-body-outside-selection',{body:b});}}
  for(const material of strings(r.materials,'materials')){materialIds.add(material);const known=context.materials;if(!known||(Array.isArray(known)?!known.some(m=>(typeof m==='string'?m:m.id)===material):!Object.hasOwn(known,material)))addIssue('missing-material',{material});}
 }
 // Every joint leaving the selected physical graph needs an authored boundary.
 for(const jid of jointIds){const j=joints.get(jid);for(const b of [j.parent,j.child])if(!bodyIds.has(b)&&!boundaryMap.has(b))addIssue('unresolved-joint-boundary',{joint:jid,body:b});}
 const unique=[...new Map(issues.map(x=>[JSON.stringify(x),x])).values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 return {schema:1,id,name:subs.get(id).name??id,sourceRevision:context.sourceRevision??null,provenance:sorted(closure).map(id=>({subsystem:id,...subs.get(id).provenance})),dependencyGraph:{subsystems:sorted(closure).map(id=>({id,dependencies:subs.get(id).dependencies??[]})),joints:sorted(jointIds).map(id=>({id,parent:joints.get(id).parent,child:joints.get(id).child})),motors:sorted(motorIds).map(id=>({id,joint:motors.get(id).joint})),transmissions:sorted(transmissionIds).map(id=>({id,driver:transmissions.get(id).driver,follower:transmissions.get(id).follower}))},subsystems:sorted(closure),occurrenceIds:sorted(selected),stationarySupportIds:sorted(supports).filter(p=>selected.has(p)),excludedOccurrenceIds:sorted(excluded),mechanical:{bodies:sorted(bodyIds),joints:sorted(jointIds),motors:sorted(motorIds),transmissions:sorted(transmissionIds)},boundaries:[...boundaryMap.values()].sort((a,b)=>a.body.localeCompare(b.body)),requirements:{expectedBodies:sorted(expectedBodies),contactBodies:sorted(contactBodies),materials:sorted(materialIds)},physics:{complete:unique.length===0,nativeValidationRequired:true,issues:unique,scope:'Definition completeness only; native validation, contact tests and hardware calibration remain separate.'}};
}
