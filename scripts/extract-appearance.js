// Finalize the native XCAF appearance artifact after validating its source and
// occurrence identities. Geometry and surface styles were extracted together.
import path from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const [root,source]=process.argv.slice(2);
if(!root||!source)throw Error('Usage: bun scripts/extract-appearance.js FIELD_DIRECTORY SOURCE_STEP');
const json=async file=>JSON.parse(await readFile(path.join(root,file)));
const hash=b=>createHash('sha256').update(b).digest('hex');
const assembly=await json('assembly.json'),instances=await json('instances.json'),appearance=await json('appearance.json');
if(hash(await readFile(source))!==assembly.sourceHash||appearance.sourceHash!==assembly.sourceHash)throw Error('Appearance source mismatch');
if(instances.length!==Object.keys(appearance.instances).length||instances.some(n=>!appearance.instances[n.id]))throw Error('Appearance occurrence mismatch');
appearance.instancesHash=hash(JSON.stringify(instances));
try{
 const presentation=await json('presentation.json');
 if(presentation.schema!==1||presentation.sourceHash!==assembly.sourceHash)throw Error('Stale presentation overrides');
 for(const [id,offset] of Object.entries(presentation.offsets)){
  if(!appearance.instances[id]||!Array.isArray(offset)||offset.length!==3||!offset.every(Number.isFinite))throw Error('Invalid presentation offset '+id);
  appearance.instances[id].offset=offset;
 }
}catch(error){if(error.code!=='ENOENT')throw error;}
await writeFile(path.join(root,'appearance.json'),JSON.stringify(appearance));
console.log(JSON.stringify({occurrences:instances.length,multicolor:Object.values(appearance.instances).filter(x=>x.parts).length,colors:new Set(Object.values(appearance.instances).flatMap(x=>x.parts?x.parts.map(p=>p.color):[x.color])).size}));
