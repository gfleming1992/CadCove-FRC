import path from 'node:path';
import {readFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateSceneBindings} from './scene-bindings.js';
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const relative=name=>typeof name==='string'&&name.split('/').every(p=>p&&p!=='.'&&p!=='..')&&!/[\\:?#\x00-\x1f]/.test(name);
export async function prepareMatchAssets({robot,field,bindings},robots,bodyIds){
 const files=new Map(),descriptors={};
 for(const [kind,directory]of Object.entries({robot,field})){
  const root=await realpath(directory);
  const add=async name=>{
   if(!relative(name))throw Error('Invalid CAD asset path');const file=await realpath(path.join(root,name));
   if(!file.startsWith(root+path.sep))throw Error('CAD asset escaped its root');
   const bytes=await readFile(file),key=kind+'/'+name;files.set(key,{file,hash:sha256(bytes),bytes:bytes.length});descriptors[key]={sha256:sha256(bytes),bytes:bytes.length};return bytes;
  };
  const catalog=JSON.parse(await add('catalog.json')),instances=JSON.parse(await add('instances.json'));let appearance;
  try{appearance=JSON.parse(await add('appearance.json'));Object.assign(catalog,appearance.catalog);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(appearance&&(appearance.schema!==1||appearance.instancesHash!==sha256(JSON.stringify(instances))))throw Error('Stale CAD appearance');
  const used=new Set(instances.flatMap(n=>{
   if(!appearance)return [n.asset];const style=appearance.instances[n.id];if(!style)throw Error('Missing CAD appearance '+n.id);
   return style.parts?style.parts.map(part=>part.asset??n.asset):[style.asset??n.asset];
  }));
  // Catalogs may contain unused source-only entries with no tessellation.
  for(const id of used){
   const item=catalog[id];if(!item||typeof item.mesh!=='string')throw Error('Missing CAD mesh descriptor: '+id);
   const key=kind+'/'+item.mesh;if(!files.has(key))await add(item.mesh);
   if(files.get(key).hash!==item.meshSha256)throw Error('CAD mesh checksum mismatch: '+key);
   if(item.lods!==undefined){
    if(!Array.isArray(item.lods)||item.lods.length>5)throw Error('Invalid visual levels');
    for(const lod of item.lods){if(!Number.isFinite(lod.errorMM)||lod.errorMM<0)throw Error('Invalid visual error');const bytes=await add(lod.mesh);if(sha256(bytes)!==lod.meshSha256)throw Error('Visual level checksum mismatch');}
   }
  }
 }
 const binding=validateSceneBindings(JSON.parse(await readFile(bindings,'utf8'))),known=new Set(bodyIds);
 for(const r of robots)for(const b of Object.values(binding.robot))if(!known.has(r.prefix+b.body))throw Error('Unknown robot visual body: '+r.prefix+b.body);
 for(const b of Object.values(binding.field))if(!known.has(b.body))throw Error('Unknown field visual body: '+b.body);
 const definition={schema:1,files:descriptors,bindings:binding,robots:robots.map(({id,prefix})=>({id,prefix})),bodyIds};
 const revision=sha256(JSON.stringify(definition)),manifest={...definition,revision,assetRoot:'/assets/'+revision,authority:'server',prediction:false,interpolation:false};
 return {manifest,async read(key){const descriptor=files.get(key);if(!descriptor)return null;const bytes=await readFile(descriptor.file);if(sha256(bytes)!==descriptor.hash)throw Error('CAD assets changed; restart the match with a new revision');return bytes;}};
}
