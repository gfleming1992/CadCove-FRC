import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {cadFeedback} from './cad-feedback.js';
import {cadProjectSettings} from './cad-project.js';
import {projectLayout,cacheFile,inside,readSources} from '../vendor/cad-core/extensions/vscode/src/project-files.js';
import {validateMechanism} from '../vendor/cad-core/src/core/mechanism.js';
const hash=x=>createHash('sha256').update(x).digest('hex');
export async function mechanismPreview(workspace,{field=false}={}){
 const settings=await cadProjectSettings(workspace),layout=await projectLayout(workspace,settings),feedback=await cadFeedback(workspace);
 if(!feedback.ok)throw Error('Build the current CAD before opening mechanism preview: '+feedback.state);
 const binary=await cacheFile(layout,settings.entryPoint,'scene.bin'),meta=JSON.parse(await fs.readFile(await cacheFile(layout,settings.entryPoint,'scene.json'),'utf8'));
 if(meta.revision!==feedback.sourceRevision||meta.runtime!==feedback.runtime||hash(await fs.readFile(binary))!==meta.meshHash)throw Error('CAD mesh cache is stale or damaged');
 const file=path.posix.join(path.posix.dirname(settings.entryPoint),'mechanism.json');
 const sources=await readSources(layout.sourceRoot,layout.buildRoot),text=sources[file];if(!text)throw Error('Missing mechanism.json');
 const definition=JSON.parse(text);validateMechanism(definition,feedback.parts.map(p=>p.id));
 if(definition.sourceStep){const s=definition.sourceStep;if(sources[s.file]!=='sha256:'+s.sha256)throw Error('STEP source changed; regenerate the mechanism projection');}
 const descriptor={schema:1,workspace,entry:settings.entryPoint,binary,meshHash:meta.meshHash,sourceRevision:meta.revision,mechanismHash:hash(text),definition,parts:feedback.parts.map(p=>p.id),field:null};
 if(field){
  const config=JSON.parse(await fs.readFile(path.join(workspace,'.cadcove/project.json'),'utf8'));
  const profilePath=await inside(workspace,config.simulationProject??'robot.sim.json'),profile=JSON.parse(await fs.readFile(profilePath,'utf8'));
  if(!profile.cad?.field)throw Error('No field CAD configured');
  descriptor.field=await inside(path.dirname(profilePath),profile.cad.field);
 }
 return descriptor;
}
export async function assertPreviewFresh(descriptor){
 const current=await mechanismPreview(descriptor.workspace);
 if(current.sourceRevision!==descriptor.sourceRevision||current.mechanismHash!==descriptor.mechanismHash||current.meshHash!==descriptor.meshHash)throw Error('CAD or mechanism changed; reopen preview before continuing');
}
