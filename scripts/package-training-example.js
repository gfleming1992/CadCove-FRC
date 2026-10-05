// Engineering build only. End users receive the generated, checked bundle.
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,readdir,readFile,writeFile,rm,lstat,mkdir} from 'node:fs/promises';
import {allowedExamplePath,exampleDigest,decodeExampleBundle} from '../lib/example-bundle.js';
import {readRobotProject,auditRobotProject} from '../lib/robot-project.js';
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--output')throw Error('Usage: bun scripts/package-training-example.js --output NEW_JSON_FILE');
const root=path.resolve(import.meta.dir,'..'),output=path.resolve(args[1]);
try{await lstat(output);throw Error('Example bundle output already exists');}catch(e){if(e.code!=='ENOENT')throw e;}
const temp=await mkdtemp(path.join(os.tmpdir(),'cadcove-example-build-'));
try{
 const workspace=path.join(temp,'workspace');
 const child=Bun.spawn([process.execPath,path.join(root,'scripts/build-training-example.js'),'--output',workspace],{cwd:root,stdout:'pipe',stderr:'pipe'});
 const [out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
 if(code)throw Error('Example build failed: '+out+'\n'+err);
 const audit=await auditRobotProject(await readRobotProject(path.join(workspace,'training-profile.json')));
 if(!audit.canLoad||audit.sourceFreshness.status!=='verified')throw Error('Example build failed source/artifact audit: '+JSON.stringify(audit));
 const files=[];
 async function collect(directory,relative=''){
  for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
   const file=relative+entry.name,absolute=path.join(directory,entry.name);
   if(entry.isDirectory())await collect(absolute,file+'/');
   else{
    if(!entry.isFile()||!allowedExamplePath(file))throw Error('Unexpected example distribution file: '+file);
    const bytes=await readFile(absolute);files.push({path:file,bytes:bytes.length,sha256:exampleDigest(bytes),data:bytes.toString('base64')});
   }
  }
 }
 await collect(workspace);
 const bundle={schema:1,id:'training-robot',files};decodeExampleBundle(bundle);
 const bytes=JSON.stringify(bundle)+'\n';await mkdir(path.dirname(output),{recursive:true});await writeFile(output,bytes,{flag:'wx'});
 console.log(JSON.stringify({ok:true,output,files:files.length,bytes:Buffer.byteLength(bytes),sha256:exampleDigest(bytes),robotSDKsBundled:false}));
}finally{await rm(temp,{recursive:true,force:true});}
