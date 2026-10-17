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

test('team robot defaults to Python and accounts for every authored design without fallback',async()=>{
 const robot=path.join(source,'cad-assets/robot');
 const migration=await json('source/cad-assets/robot/native/migration.json');
 expect(migration.expectedAuthoredParts).toBe(109);
 expect(migration.converted).toHaveLength(109);
 expect(migration.pending).toEqual([]);
 const ids=new Set(migration.converted.map(p=>p.id));
 expect(ids.size).toBe(109);
 const historical=await json('source/cad-assets/robot/native/evidence/legacy-geometry-validation.json');
 expect([...ids].sort()).toEqual(historical.parts.map(p=>p.id).sort());
 const instances=await json('source/cad-assets/robot/instances.json');
 expect(instances.filter(p=>ids.has(p.asset))).toHaveLength(178);
 const entry=await readFile(path.join(robot,'models.py'),'utf8');
 expect(entry).toContain("migration['pending']");
 expect(entry).toContain('refusing an implicit STEP fallback');
 for(const part of migration.converted){
  expect(part.module).toMatch(/^p_[a-z0-9_]+$/);
  const code=await readFile(path.join(robot,'native/parts',part.module+'.py'),'utf8');
  expect(code).toMatch(/^(?:def make\(|from native\.[a-z0-9_.]+ import make\b)/m);
  expect(code).toMatch(/^def build\(/m);
  // Individual authored designs must build geometry, not quietly become imports.
  expect(code).not.toMatch(/\b(?:importStep|import_step|importBrep|readBrep|read_step)\s*\(/);
 }
});

test('native robot source closure contains no JavaScript execution or original-part geometry fallback',async()=>{
 const native=path.join(source,'cad-assets/robot/native');
 async function audit(dir){for(const e of await readdir(dir,{withFileTypes:true})){
  const f=path.join(dir,e.name);
  if(e.isDirectory()){await audit(f);continue;}
  expect(e.name).not.toMatch(/\.(?:step|stp|brep|js|mjs|cjs|wasm)$/i);
  if(!e.name.endsWith('.py'))continue;
  const code=await readFile(f,'utf8');
  expect(code).not.toMatch(/^\s*(?:from|import)\s+(?:subprocess|js2py|quickjs|pythonmonkey|dukpy|execjs|brepjs)\b/m);
  expect(code).not.toMatch(/["'][^"'\n]*\.(?:js|mjs|cjs|wasm)["']/);
  expect(code).not.toMatch(/["'][^"'\n]*(?:components|parametric)\/[^"'\n]*["']/);
  // Native trim repair may roundtrip its freshly generated shape through STEP.
  // It must not read a retained asset or serialized BREP as authored geometry.
  expect(code).not.toMatch(/\b(?:importBrep|readBrep|import_step|read_step)\s*\(/);
  if(/\bimportStep\s*\(/.test(code)){
   expect(code).toContain('TemporaryDirectory(');
   expect(code).toContain('generated.step');
   expect(code).toContain('cq.exporters.export(shape,path)');
   expect(code.indexOf('cq.exporters.export(shape,path)')).toBeLessThan(code.indexOf('cq.importers.importStep(path)'));
   const stepPaths=[...code.matchAll(/["']([^"'\n]*\.(?:step|stp))["']/g)].map(m=>m[1]);
   expect(stepPaths.every(p=>p==='generated.step')).toBe(true);
  }
 }}
 await audit(native);
});

test('fresh team workspace selects models.py without a legacy executable entry',async()=>{
 const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises');
 const os=await import('node:os');
 const {initializeToolbox}=await import('../lib/toolbox-project.js');
 const workspace=await mkdtemp(path.join(os.tmpdir(),'cadcove-native-default-'));
 try{
  const cad=path.join(workspace,'cad-assets/robot');await mkdir(cad,{recursive:true});
  for(const name of ['models.py'])await writeFile(path.join(cad,name),await readFile(path.join(source,'cad-assets/robot',name)));
  await initializeToolbox({workspace,cadDirectory:'cad-assets/robot'});
  const project=JSON.parse(await readFile(path.join(workspace,'.cadcove/project.json')));
  expect(project.entryPoint).toBe('models.py');
  expect(project.sourceDirectory).toBe('cad-assets/robot');
  expect(await readFile(path.join(cad,'models.py'),'utf8')).toBe(await readFile(path.join(source,'cad-assets/robot/models.py'),'utf8'));
 }finally{await rm(workspace,{recursive:true,force:true});}
});

test('native migration evidence distinguishes shape validation from STEP exchange limits',async()=>{
 const report=await json('source/native-migration-validation.json');
 expect(report.authoredParts).toBe(109);
 expect(report.defaultValidity.length).toBe(109);
 expect(report.defaultValidity.every(p=>p.ok&&p.volumeMm3>0)).toBe(true);
 expect(report.vendorValidity.length).toBe(320);
 expect(report.vendorValidity.every(p=>p.valid)).toBe(true);
 expect(JSON.stringify(report.bracketsRailsShroud)).toContain('STEP');
});
