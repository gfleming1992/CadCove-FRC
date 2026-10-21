import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {connectEditor} from './mcp-proxy.js';
export async function cadMotion(command,options){
 const action={'cad-rotate':'rotate','cad-move':'move','cad-motion-play':'play','cad-motion-pause':'pause','cad-motion-resume':'resume','cad-motion-seek':'seek','cad-mechanisms':'list','cad-animate':'animate','cad-motion-stop':'stop','cad-motion-reset':'reset','cad-motion-state':'state'}[command];
 const workspace=path.resolve(options.workspace??process.cwd());
 const args=command==='cad-selection'?{workspace,entry:options.entry}:{workspace,entry:options.entry,action,part:options.part};
 for(const key of ['degrees','rpm','seconds'])if(options[key]!==undefined){args[key]=Number(options[key]);if(!Number.isFinite(args[key]))throw Error('--'+key+' must be finite');}
 if(['rotate','move','animate'].includes(action)&&!args.part)throw Error('--part is required (part, shaft joint, rigid body, or motor ID)');
 if(['rotate','move'].includes(action)&&args.degrees===undefined)throw Error('--degrees is required; angles are absolute joint coordinates');
 if(action==='animate'&&args.rpm===undefined)throw Error('--rpm is required');
 if(action==='play'){if(!options.input)throw Error('--input trajectory.json is required');args.trajectory=JSON.parse(await readFile(path.resolve(options.input),'utf8'));}
 if(action==='seek'&&args.seconds===undefined)throw Error('--seconds is required');
 const client=await connectEditor(workspace);
 try{const result=await client.callTool({name:command==='cad-selection'?'cad_selection':'cad_motion',arguments:args});const text=result.content.find(c=>c.type==='text')?.text;if(result.isError)throw Error(text??'CAD motion failed');return JSON.parse(text);}
 finally{await client.close();}
}
