import path from 'node:path';
import {realpath,lstat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';

export function sourceInputEntries(record){
 if(record===undefined)return null;
 if(record?.schema!==1||!Array.isArray(record.files)||!record.files.length||record.files.length>4096)throw Error('Invalid source input manifest');
 if(record.root!==undefined&&!['project','assets'].includes(record.root))throw Error('Invalid source input root');
 const names=new Set();
 for(const item of record.files){
  const file=item?.file;
  if(typeof file!=='string'||!file||file.length>2048||file.includes('\\')||/[\x00-\x1f:]/.test(file)||file.split('/').some(p=>!p||p==='.'||p==='..')||names.has(file.toLowerCase())||!/^[a-f0-9]{64}$/.test(item.sha256))throw Error('Invalid/duplicate source input path or digest');
  names.add(file.toLowerCase());
 }
 return record.files;
}

export async function sourceInputRoot(project,record){
 // Editable CAD can be a sibling of collision assets. Pin it against the
 // manifest directory without changing how the native engine resolves assets.
 return realpath(record?.root==='project'?project.root:project.profile.runtime.assetRoot?path.resolve(project.root,project.profile.runtime.assetRoot):project.root);
}

export async function sourceInputFile(root,file){
 const resolved=await realpath(path.join(root,file));
 const relative=path.relative(root,resolved);
 if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Source input must be a file inside the declared asset root: '+file);
 if(!(await lstat(resolved)).isFile())throw Error('Source input is not a regular file: '+file);
 return resolved;
}

export async function verifySourceInputs(project,record){
 const files=sourceInputEntries(record);
 if(files===null)return {status:'untracked',files:0,errors:[],note:'This build does not record editable source inputs; only compiled artifact consistency can be checked.'};
 const root=await sourceInputRoot(project,record),errors=[];
 for(const item of files){
  try{
   const absolute=await sourceInputFile(root,item.file),hash=createHash('sha256');
   // STEP/BREP sources may be large; do not load each one into a second buffer.
   for await(const chunk of createReadStream(absolute))hash.update(chunk);
   if(hash.digest('hex')!==item.sha256)errors.push('Source input changed: '+item.file+'; rebuild CAD/world/bindings before simulation');
  }catch(error){errors.push('Source input unavailable: '+item.file+' ('+error.message+')');}
 }
 return {status:errors.length?'stale':'verified',files:files.length,errors,note:'Hashes cover declared inputs only; the build must record its complete source dependency closure.'};
}
