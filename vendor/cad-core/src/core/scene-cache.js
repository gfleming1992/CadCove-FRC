import {hash} from './revision.js';
import {decodeScene} from './mesh.js';

// A CLI-produced scene is usable without Python only when its runtime, source
// revision and binary digest all match. Incomplete writes are retried later.
export async function currentCachedScene(cached,revision,runtime) {
  if(!cached||cached.revision!==revision||cached.runtime!==runtime)return null;
  try {
    if(await hash(cached.bytes)!==cached.meshHash)return null;
    return decodeScene(cached.bytes);
  }catch{return null;}
}
