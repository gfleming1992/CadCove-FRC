import {test,expect} from 'bun:test';
import {readFile,readdir,lstat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dir,'../examples/team3310-rebuilt'),source=path.join(root,'source');
const json=async f=>JSON.parse(await readFile(path.join(root,f)));
const hash=b=>createHash('sha256').update(b).digest('hex');
test('team example ships its CAD closure and robot colliders, with official-only field recipes',async()=>{
 const pin=await json('field-source.json'),scene=await json('source/scene-bindings.json'),world=await json('source/world.json');
 expect(new URL(pin.url).hostname).toBe('firstfrc.blob.core.windows.net');
 expect(pin.occurrences.length).toBe(6186);expect(new Set(pin.occurrences.map(x=>x.id)).size).toBe(6186);
 expect(hash(await readFile(path.join(source,'world.json')))).toBe(scene.worldHash);
 for(const input of scene.sourceInputs.files){
  if(input.file.startsWith('physics-assets/build/colliders/')&&pin.colliders[input.sha256])continue;
  expect(hash(await readFile(path.join(source,input.file)))).toBe(input.sha256);
 }
 for(const b of world.bodies)for(const c of b.colliders||[])if(c.kind==='mesh_file'){
  expect(!!pin.colliders[c.sha256]||await Bun.file(path.join(source,'physics-assets',c.file)).exists()).toBe(true);
 }
 expect(await Bun.file(path.join(source,'cad-assets/field/field.step')).exists()).toBe(false);
 expect(await Bun.file(path.join(source,'robot-code/build/libs/robot.jar')).exists()).toBe(false);
 expect((await json('source/robot-code/.wpilib/wpilib_preferences.json')).teamNumber).toBe(0);
 expect((await json('source/cad-assets/robot/instances.json')).length).toBe(1958);
});
test('team example has no session descriptors, credentials, field geometry or platform binaries',async()=>{
 async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const f=path.join(dir,e.name);expect((await lstat(f)).isSymbolicLink()).toBe(false);if(e.isDirectory()){expect(['node_modules','ctre_sim','.git','sessions'].includes(e.name)).toBe(false);await walk(f);}else{expect(/\.(?:dylib|dll|so|exe|log)$/.test(e.name)).toBe(false);expect(/^\.env|^networktables\.json$|^session\.json$/.test(e.name)).toBe(false);}}}
 await walk(source);
});
