import fs from 'node:fs/promises';
import path from 'node:path';

// Keep large solver trajectories out of the bounded MCP command envelope.
// Only read files inside the selected workspace, including after symlink resolution.
export async function canvasMotionInput(root,method,args){
 if(method!=='motion'||args.solutionFile===undefined)return args;
 if(args.action!=='play-solved'||args.solution!==undefined)throw Error('solutionFile requires play-solved and cannot be combined with solution');
 if(typeof args.solutionFile!=='string'||!args.solutionFile)throw Error('solutionFile must name a workspace JSON file');
 const base=await fs.realpath(root),file=await fs.realpath(path.resolve(base,args.solutionFile));
 const relative=path.relative(base,file);
 if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('solutionFile must be inside the workspace');
 const handle=await fs.open(file,'r');
 try{
  const stat=await handle.stat();
  if(!stat.isFile()||stat.size>32*1024*1024)throw Error('solutionFile must be a regular file no larger than 32 MiB');
  const solution=JSON.parse(await handle.readFile('utf8'));
  const {solutionFile,...rest}=args;return {...rest,solution};
 }finally{await handle.close();}
}

// Selection of a canvas is independent of its command implementation. Ambiguous
// hidden tabs require an explicit target; no silent fallback to another scene.
export function chooseCanvas(canvases,{target='active',entry}={}){
 if(!['active','cad','field'].includes(target))throw Error('Canvas target must be active, cad or field');
 let candidates=canvases.filter(c=>(target==='active'||c.kind===target)&&(!entry||(c.kind==='cad'&&c.entry===entry)));
 const active=candidates.filter(c=>c.active);
 if(active.length===1)return active[0];
 if(candidates.length===1)return candidates[0];
 if(!candidates.length)throw Error('Open the requested CAD or field canvas first');
 throw Error('Multiple canvases are open; select a canvas tab or specify target and entry');
}
