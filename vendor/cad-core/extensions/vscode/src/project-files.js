import {SOURCE_LIMITS, checkSourceBudget} from '../../../src/core/source-limits.js';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import path from 'node:path';
const skipped=new Set(['node_modules','dist','.git','.instantcad']);
export function relativePath(value) {
  if(typeof value!=='string'||!value||value.includes('\\')||value.includes('\0')||path.isAbsolute(value)||value.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Use a relative path inside the model project');
  return value;
}
export async function inside(root,relative,{create=false}={}) {
  relativePath(relative);
  const canonical=await fs.realpath(root), target=path.resolve(root,relative);
  let parent=target;
  while(true){
    try{
      const resolved=await fs.realpath(parent);
      if(resolved!==canonical&&!resolved.startsWith(canonical+path.sep))throw Error('Path leaves the model project');
      break;
    }catch(error){if(!create||error.code!=='ENOENT')throw error;const next=path.dirname(parent);if(next===parent)throw error;parent=next;}
  }
  return target;
}
export async function readSources(root, excludedDirectory, {cache}={}) {
  const files={};let total=0;
  // Cache bytes/digests, not directory contents: every request still enumerates
  // files and checks their identity and nanosecond modification/change times.
  const seen=new Set();
  async function content(file,relative,binary){
    await inside(root,relative);
    const stat=await fs.stat(file,{bigint:true});
    if(!binary&&stat.size>BigInt(SOURCE_LIMITS.fileBytes))throw Error(`${relative} exceeds 1 MB`);
    const key=[stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].join(':');
    seen.add(file);
    if(cache?.get(file)?.key===key)return cache.get(file).value;
    let value;
    if(binary){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);value='sha256:'+hash.digest('hex');}
    else value=await fs.readFile(file,'utf8');
    const after=await fs.stat(file,{bigint:true});
    if([after.dev,after.ino,after.size,after.mtimeNs,after.ctimeNs].join(':')!==key)throw Error('Source changed while reading '+relative);
    cache?.set(file,{key,value});return value;
  }
  async function visit(dir,prefix='',depth=0){
    if(depth>12)throw Error('Model folder nesting is too deep');
    for(const item of await fs.readdir(dir,{withFileTypes:true})){
      if(item.name.startsWith('.')||skipped.has(item.name)||item.isSymbolicLink())continue;
      const relative=prefix+item.name, file=path.join(dir,item.name);
      if(item.isDirectory()){if(excludedDirectory&&path.resolve(file)===path.resolve(excludedDirectory))continue;await visit(file,relative+'/',depth+1);}
      else if(item.isFile()&&/\.(py|json)$/i.test(item.name)){
        const code=await content(file,relative,false);total+=Buffer.byteLength(code);
        files[relative]=code;
        checkSourceBudget(Object.keys(files).length,total);
      }else if(item.isFile()&&/\.(step|stp|brep)$/i.test(item.name)){
        files[relative]=await content(file,relative,true);
        total+=Buffer.byteLength(files[relative]);checkSourceBudget(Object.keys(files).length,total);
      }
    }
  }
  await visit(root);if(cache)for(const file of cache.keys())if(!seen.has(file))cache.delete(file);return files;
}
export function artifactPath(entry,name) {
  if(!['scene.bin','scene.json','status.json','preview.png','profile.json'].includes(name))throw Error('Unsupported cache artifact');
  relativePath(entry);
  const base=path.posix.dirname(entry), file=path.posix.basename(entry);
  return path.posix.join(base,'.instantcad',...(file==='model.js'?[]:['entries',file]),name);
}

export async function projectLayout(workspaceRoot,settings={}) {
  const sourceDirectory=settings.sourceDirectory??'.';
  const buildDirectory=settings.buildDirectory??'';
  const entryPoint=relativePath(settings.entryPoint??'models.py');
  if(!/\.py$/.test(entryPoint))throw Error('CAD entryPoint must be a Python file. Convert legacy JavaScript CAD to CadQuery.');
  const sourceRoot=sourceDirectory==='.'?await fs.realpath(workspaceRoot):await inside(workspaceRoot,sourceDirectory);
  if(!(await fs.stat(sourceRoot)).isDirectory())throw Error('InstantCAD sourceDirectory must be a folder');
  let buildRoot;
  if(buildDirectory){
    buildRoot=await inside(workspaceRoot,buildDirectory,{create:true});
    if(sourceRoot===buildRoot||sourceRoot.startsWith(buildRoot+path.sep))throw Error('CAD buildDirectory cannot contain the CAD sourceDirectory');
  }
  return {workspaceRoot,sourceRoot,buildRoot,entryPoint,buildDirectory};
}
export async function cacheFile(layout,entry,name,{create=false}={}) {
  artifactPath(entry,name); // Validate the entry and fixed artifact name whitelist.
  return layout.buildRoot
    ? inside(layout.workspaceRoot,path.posix.join(layout.buildDirectory,entry.replace(/\.js$/,''),name),{create})
    : inside(layout.sourceRoot,artifactPath(entry,name),{create});
}

// Publish the worker's existing binary without a webview/base64 round trip.
// Only the extension supplies artifact; never accept a webview-selected path.
export async function commitNativeScene(layout,entry,artifact,revision,runtime){
  const binary=await cacheFile(layout,entry,'scene.bin',{create:true});
  const meta=await cacheFile(layout,entry,'scene.json',{create:true});
  const digest=createHash('sha256');
  for await(const chunk of createReadStream(artifact))digest.update(chunk);
  const meshHash=digest.digest('hex'),tmp=meta+'.'+randomBytes(8).toString('hex')+'.tmp';
  try{
    await fs.writeFile(tmp,JSON.stringify({revision,meshHash,runtime}),{flag:'wx'});
    await fs.rename(artifact,binary);
    await fs.rename(tmp,meta);
  }finally{await fs.rm(tmp,{force:true});}
  return {revision,meshHash,runtime};
}
