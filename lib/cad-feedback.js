import path from 'node:path';
import {readFile, stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {projectLayout,readSources,cacheFile} from '../vendor/cad-core/extensions/vscode/src/project-files.js';
import {snapshot,runtimeIdentity} from '../vendor/cad-core/src/core/revision.js';
import {cadProjectSettings} from './cad-project.js';

export async function cadFeedback(workspace,{preview=false,entry}={}) {
 if(!workspace)throw Error('--workspace is required');
 const root=path.resolve(workspace);
 const settings=await cadProjectSettings(root);if(entry)settings.entryPoint=entry;
 const layout=await projectLayout(root,settings);
 let status;
 try{status=JSON.parse(await readFile(await cacheFile(layout,layout.entryPoint,'status.json'),'utf8'));}
 catch(error){if(error.code!=='ENOENT')throw error;}
 // A standalone CLI can inspect feedback produced by a locally rebuilt editor
 // kernel. Bind its source check to the runtime that actually built that scene.
 const identity=status?.runtime??runtimeIdentity;
 if(typeof identity!=='string'||!identity.trim()||identity.length>512||/[\x00-\x1f]/.test(identity))throw Error('Malformed CAD runtime identity');
 const source=await snapshot(await readSources(layout.sourceRoot,layout.buildRoot,{native:layout.entryPoint.endsWith('.py')}),layout.entryPoint,identity);
 const base={schema:1,command:preview?'cad-preview':'cad-status',workspace:root,entry:layout.entryPoint,sourceRevision:source.revision,runtime:identity};
 if(status===undefined)return {...base,ok:false,state:'missing-feedback',next:'Open this CAD model in the toolbox and wait for its build.'};
 if(!status||typeof status.ok!=='boolean'||(status.revision!==null&&typeof status.revision!=='string'))throw Error('Malformed CAD build feedback');
 if(!status.ok)return {...base,ok:false,state:'build-error',acceptedRevision:status.revision,error:status.error??'CAD build failed',next:'Fix the source and wait for a successful build.'};
 if(status.revision!==source.revision)return {...base,ok:false,state:'stale-feedback',acceptedRevision:status.revision,next:'The source changed; wait for the editor to rebuild this revision.'};
 const staleDuringRead=async()=>{
  const latest=await snapshot(await readSources(layout.sourceRoot,layout.buildRoot,{native:layout.entryPoint.endsWith('.py')}),layout.entryPoint,identity);
  return latest.revision!==source.revision?{...base,sourceRevision:latest.revision,ok:false,state:'stale-feedback',acceptedRevision:status.revision,next:'Source changed while reading feedback; wait for the editor to rebuild.'}:null;
 };
 if(!preview)return await staleDuringRead()??{...base,ok:true,state:'ready',acceptedRevision:status.revision,parts:status.parts,timings:status.timings,scope:'Saved CAD build feedback for the current source revision; not simulation qualification'};
 if(status.preview?.revision!==source.revision||!/^[a-f0-9]{64}$/.test(status.preview?.sha256??''))return {...base,ok:false,state:'missing-preview',acceptedRevision:status.revision,next:'Rebuild in the current toolbox to write a revision-bound preview.'};
 let image;
 try{image=await cacheFile(layout,layout.entryPoint,'preview.png');if(!(await stat(image)).isFile())throw Error('CAD preview is not a file');}
 catch(error){if(error.code==='ENOENT')return {...base,ok:false,state:'missing-preview',acceptedRevision:status.revision,next:'Wait for the editor to write the build preview.'};throw error;}
 const bytes=await readFile(image);
 if(createHash('sha256').update(bytes).digest('hex')!==status.preview.sha256)return {...base,ok:false,state:'stale-preview',acceptedRevision:status.revision,next:'Preview and status are from different writes; wait for the build to finish.'};
 return await staleDuringRead()??{...base,ok:true,state:'ready',acceptedRevision:status.revision,image,sha256:status.preview.sha256,mimeType:'image/png',scope:'Last saved build preview; interactive camera movements do not rewrite it'};
}
