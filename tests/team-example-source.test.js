import {test,expect} from 'bun:test';
import {readFile,readdir,lstat,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import {publishDirectory,removeStagingDirectory} from '../lib/directory-publish.js';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dir,'../examples/team3310-rebuilt'),source=path.join(root,'source');
const json=async f=>JSON.parse(await readFile(path.join(root,f)));
const hash=b=>createHash('sha256').update(b).digest('hex');

test('example cleanup waits for a temporary Windows working-directory lock',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'cadcove-cleanup-'));
 const child=Bun.spawn([process.execPath,'-e',"process.stdout.write('ready');setTimeout(()=>process.exit(0),700)"],{cwd:temp,stdout:'pipe',stderr:'inherit'});
 try{
  const reader=child.stdout.getReader();await reader.read();reader.releaseLock();
  if(process.platform==='win32')await expect(removeStagingDirectory(temp,{timeout:0})).rejects.toThrow();
  await removeStagingDirectory(temp,{timeout:5000});await child.exited;
  await expect(lstat(temp)).rejects.toThrow();
 }finally{child.kill();await child.exited;await rm(temp,{recursive:true,force:true});}
});

test('example publication preserves existing outputs and the completed staging tree',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'cadcove-publish-'));
 try{
  const stage=path.join(temp,'stage'),output=path.join(temp,'output');await mkdir(stage);await mkdir(output);
  await writeFile(path.join(stage,'model.py'),'new');await writeFile(path.join(output,'team.py'),'keep');
  await expect(publishDirectory(stage,output)).rejects.toThrow('already exists');
  expect(await readFile(path.join(stage,'model.py'),'utf8')).toBe('new');
  expect(await readFile(path.join(output,'team.py'),'utf8')).toBe('keep');
 }finally{await rm(temp,{recursive:true,force:true});}
});

test('example publication tolerates a departing process holding its working directory',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'cadcove-publish-'));
 const stage=path.join(temp,'stage'),output=path.join(temp,'output');await mkdir(stage);await writeFile(path.join(stage,'model.py'),'complete');
 const child=Bun.spawn([process.execPath,'-e',"process.stdout.write('ready');setTimeout(()=>process.exit(0),500)"],{cwd:stage,stdout:'pipe',stderr:'inherit'});
 try{
  const reader=child.stdout.getReader();await reader.read();reader.releaseLock();
  await publishDirectory(stage,output,{timeout:5000});await child.exited;
  expect(await readFile(path.join(output,'model.py'),'utf8')).toBe('complete');
  await expect(lstat(stage)).rejects.toThrow();
 }finally{child.kill();await child.exited;await rm(temp,{recursive:true,force:true});}
});
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

test('robot component dependencies isolate profiles while retaining shared helper inputs',async()=>{
 const python=process.env.CADCOVE_PYTHON??'python3';
 const code=`import ast,json,types,sys
from pathlib import Path
root=Path(sys.argv[1])
tree=ast.parse((root/'models.py').read_text())
function=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='prototypes')
namespace={'ROOT':root,'json':json,'importlib':types.SimpleNamespace(import_module=lambda name:types.SimpleNamespace(make=lambda:None))}
exec(compile(ast.Module(body=[function],type_ignores=[]),'models.py','exec'),namespace)
class Context:
    files={str(p.relative_to(root)):p.read_text() for p in (root/'native').rglob('*') if p.suffix in ('.py','.json')}
    files['models.py']=(root/'models.py').read_text()
    def __init__(self):self.deps={}
    def component(self,name,factory,dependencies,**kwargs):self.deps[name]=set(dependencies);return None
ctx=Context();namespace['prototypes'](ctx)
builders=json.loads((root/'native/migration.json').read_text())['converted']
profiles={p['id']:'native/data/'+p['id']+'.json' for p in builders if (root/'native/data'/(p['id']+'.json')).exists()}
for key,profile in profiles.items():
    affected=[name for name,deps in ctx.deps.items() if profile in deps]
    assert affected==[key],(profile,affected)
for p in builders:
    deps=ctx.deps[p['id']]
    assert 'native/manufacturing.py' in deps
    assert 'native/data/drive-spacer.json' in deps
    assert 'native/parts/'+p['module']+'.py' in deps
    assert 'native/migration.json' in deps and 'models.py' in deps
print(json.dumps({'profiles':len(profiles),'components':len(ctx.deps)}))
`;
 const child=Bun.spawn([python,'-c',code,path.join(source,'cad-assets/robot')],{stdout:'pipe',stderr:'pipe'});
 const [out,err,status]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
 expect(err).toBe('');expect(status).toBe(0);const result=JSON.parse(out);expect(result.components).toBe(429);expect(result.profiles).toBeGreaterThan(50);
});
