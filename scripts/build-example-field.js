// Native OCCT import; field assets are downloaded from FIRST and rebuilt locally.
import path from 'node:path';
const [source,output]=process.argv.slice(2);
if(!source||!output||process.argv.length!==4)throw Error('Usage: bun scripts/build-example-field.js FIELD_STEP OUTPUT');
const repo=path.resolve(import.meta.dir,'..');
const processHandle=Bun.spawn([process.env.CADCOVE_PYTHON||'python3','-B',path.join(repo,'scripts/native-field.py'),path.resolve(source),path.resolve(output),path.join(repo,'examples/team3310-rebuilt/field-source.json')],{stdout:'inherit',stderr:'inherit'});
if(await processHandle.exited)throw Error('Native field import failed');
