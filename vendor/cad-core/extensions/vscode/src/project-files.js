import {SOURCE_LIMITS, checkSourceBudget} from '../../../src/core/source-limits.js';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
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
export async function readSources(root, excludedDirectory) {
  const files={};let total=0;
  async function visit(dir,prefix='',depth=0){
    if(depth>12)throw Error('Model folder nesting is too deep');
    for(const item of await fs.readdir(dir,{withFileTypes:true})){
      if(item.name.startsWith('.')||skipped.has(item.name)||item.isSymbolicLink())continue;
      const relative=prefix+item.name, file=path.join(dir,item.name);
      if(item.isDirectory()){if(excludedDirectory&&path.resolve(file)===path.resolve(excludedDirectory))continue;await visit(file,relative+'/',depth+1);}
      else if(item.isFile()&&/\.(py|json)$/i.test(item.name)){
        await inside(root,relative);
        if((await fs.stat(file)).size>SOURCE_LIMITS.fileBytes)throw Error(`${relative} exceeds 1 MB`);
        const code=await fs.readFile(file,'utf8');total+=Buffer.byteLength(code);
        files[relative]=code;
        checkSourceBudget(Object.keys(files).length,total);
      }else if(item.isFile()&&/\.(step|stp|brep)$/i.test(item.name)){
        await inside(root,relative);const hash=createHash('sha256');
        for await(const chunk of createReadStream(file))hash.update(chunk);
        files[relative]='sha256:'+hash.digest('hex');
        total+=Buffer.byteLength(files[relative]);checkSourceBudget(Object.keys(files).length,total);
      }
    }
  }
  await visit(root);return files;
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
