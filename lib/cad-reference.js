import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {bundledRuntime,runtimeRoot} from './runtime-location.js';
const version='2.6.1';
const names=['.cadcove/skills/references/cadquery-api.md'];
const hash=text=>createHash('sha256').update(text).digest('hex');
export async function cadReferenceBundle(){
 if(bundledRuntime)return JSON.parse(await readFile(path.join(runtimeRoot,'cad-reference.json'),'utf8'));
 const text=await readFile(path.join(runtimeRoot,'agent-skills/references/cadquery-api.md'),'utf8');
 return {schema:1,package:'cadquery',version,files:[{file:names[0],text,sha256:hash(text)}]};
}
export function validateCadReference(bundle){
 if(bundle?.schema!==1||bundle.package!=='cadquery'||bundle.version!==version||!Array.isArray(bundle.files)||bundle.files.length!==names.length)throw Error('Invalid CAD reference bundle');
 const files={};
 for(const entry of bundle.files){
  if(!names.includes(entry.file)||Object.hasOwn(files,entry.file)||typeof entry.text!=='string'||Buffer.byteLength(entry.text)>4*1024*1024||entry.sha256!==hash(entry.text))throw Error('Invalid CAD reference entry');
  files[entry.file]=entry.text;
 }
 return files;
}
export async function cadReferenceFiles(){return validateCadReference(await cadReferenceBundle());}
