import path from 'node:path';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {bundledRuntime,runtimeRoot} from './runtime-location.js';

const version='19.0.5';
const names=['.cadcove/skills/references/brepjs-api.md','.cadcove/skills/references/brepjs-license.md'];
const hash=text=>createHash('sha256').update(text).digest('hex');

// Declarations are searchable documentation, never executed or compiled in the
// user's workspace. Keep the reference tied to the viewer's pinned dependency.
export async function cadReferenceBundle(){
 if(bundledRuntime)return JSON.parse(await readFile(path.join(runtimeRoot,'cad-reference.json'),'utf8'));
 const root=path.join(runtimeRoot,'node_modules/brepjs');
 const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
 if(pkg.name!=='brepjs'||pkg.version!==version)throw Error('Unexpected brepjs reference version');
 const files=[];
 async function walk(directory){
  for(const entry of await readdir(path.join(root,directory),{withFileTypes:true})){
   const relative=directory+'/'+entry.name;
   if(entry.isDirectory())await walk(relative);
   else if(entry.isFile()&&entry.name.endsWith('.d.ts'))files.push(relative);
  }
 }
 await walk('dist');files.sort();
 if(!files.includes('dist/index.d.ts'))throw Error('Missing brepjs API declarations');
 let api=`# brepjs ${version} API reference\n\nGenerated from the pinned package's declaration files. Models are plain JavaScript;\nthese TypeScript signatures are reference only, with no compiler required.\nSearch for the needed function, then read its overloads and comments. Relative\nimports below describe the upstream package layout, not workspace imports.\nThe root public API starts at dist/index.d.ts; internal modules are not necessarily\npublic exports. See cad-authoring.md for the viewer contract and brepjs-license.md\nfor the unmodified upstream license.\n`;
 for(const file of files)api+=`\n## ${file}\n\n\x60\x60\x60typescript\n${await readFile(path.join(root,file),'utf8')}\n\x60\x60\x60\n`;
 const contents=[api,await readFile(path.join(root,'LICENSE'),'utf8')];
 return {schema:1,package:'brepjs',version,files:contents.map((text,i)=>({file:names[i],text,sha256:hash(text)}))};
}

export function validateCadReference(bundle){
 if(bundle?.schema!==1||bundle.package!=='brepjs'||bundle.version!==version||!Array.isArray(bundle.files)||bundle.files.length!==names.length)throw Error('Invalid CAD reference bundle');
 const files={};
 for(const entry of bundle.files){
  if(!names.includes(entry.file)||Object.hasOwn(files,entry.file)||typeof entry.text!=='string'||Buffer.byteLength(entry.text)>4*1024*1024||entry.sha256!==hash(entry.text))throw Error('Invalid CAD reference entry');
  files[entry.file]=entry.text;
 }
 return files;
}
export async function cadReferenceFiles(){return validateCadReference(await cadReferenceBundle());}
