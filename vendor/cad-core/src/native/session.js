import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {NativeCadClient,nativeIdentityFor} from './client.js';
import {snapshot,hash} from '../core/revision.js';
import {decodeScene} from '../core/mesh.js';
import {readSources,cacheFile} from '../../extensions/vscode/src/project-files.js';

// The CLI and editor use identical source identities and mesh artifacts.
// A session owns one warm Python worker; failed edits retain its last good BREP.
export class NativeCadSession {
 constructor({layout,python,worker,onLog}) {
  if(!layout.entryPoint.endsWith('.py'))throw Error('Native CAD requires a .py entry');
  Object.assign(this,{layout,worker});this.identity=nativeIdentityFor(worker);
  this.client=new NativeCadClient({python,worker,onLog});
 }
 async source(){return snapshot(await readSources(this.layout.sourceRoot,this.layout.buildRoot,{native:true}),this.layout.entryPoint,this.identity);}
 async build(){
  const started=performance.now(),source=await this.source();
  const target=await cacheFile(this.layout,this.layout.entryPoint,'scene.bin',{create:true});
  await fs.mkdir(path.dirname(target),{recursive:true});
  const temp=target+'.'+randomUUID();
  const write=async(name,value)=>{const file=await cacheFile(this.layout,this.layout.entryPoint,name,{create:true}),tmp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(tmp,JSON.stringify(value,null,2));await fs.rename(tmp,file);};
  try{
   const report=await this.client.request({kind:'build',root:this.layout.sourceRoot,entry:this.layout.entryPoint,files:source.files,revision:source.revision,output:temp});
   const bytes=await fs.readFile(temp),scene=decodeScene(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
   if((await this.source()).revision!==source.revision)throw Error('Source changed during build; result was not accepted');
   const meshHash=await hash(bytes),parts=scene.parts.map(({id,name,color,metrics})=>({id,name,color,metrics}));
   await fs.rename(temp,target);
   await write('scene.json',{revision:source.revision,meshHash,runtime:this.identity});
   const result={ok:true,revision:source.revision,runtime:this.identity,parts,timings:{...report.timings,wallMs:performance.now()-started},preview:null};
   await write('status.json',result);this.revision=source.revision;return {...result,scene:target};
  }catch(error){
   // The worker may have completed a build that was rejected by the source
   // recheck. Its exact shapes are then no longer the accepted canvas revision.
   // Keep the last good disk scene, but require a new build for exact feedback.
   const lastGoodRevision=this.revision??null;this.revision=undefined;
   await write('status.json',{ok:false,error:error.message,revision:lastGoodRevision,runtime:this.identity});throw error;
  }
  finally{await fs.rm(temp,{force:true});}
 }
 async current(){if(!this.revision)throw Error('Build successfully first');if((await this.source()).revision!==this.revision)throw Error('Source changed; build the current revision before inspecting/exporting');}
 async inspect(code){await this.current();const result=await this.client.request({kind:'inspect',code});await this.current();return {ok:true,revision:this.revision,result};}
 async export(output,ids){
  await this.current();output=path.resolve(output);
  if(!/\.(step|stp)$/i.test(output))throw Error('Export requires a .step or .stp path');
  await fs.mkdir(path.dirname(output),{recursive:true});
  const temp=output+'.'+randomUUID()+'.step';
  try{const result=await this.client.request({kind:'export',output:temp,ids});await this.current();await fs.rename(temp,output);return {ok:true,revision:this.revision,...result,output};}
  finally{await fs.rm(temp,{force:true});}
 }
 dispose(){this.client.dispose();}
}
