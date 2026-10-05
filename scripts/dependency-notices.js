import path from 'node:path';
import {writeDependencyNotices} from '../lib/dependency-notices.js';
const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--output')throw Error('Usage: bun scripts/dependency-notices.js --output DIRECTORY');
const result=await writeDependencyNotices(path.resolve(import.meta.dir,'..'),path.resolve(args[1]));
console.log(JSON.stringify({components:result.components.length,releaseReady:result.releaseReady,unresolved:result.unresolved},null,2));
