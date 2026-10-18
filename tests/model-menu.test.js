import {test,expect} from 'bun:test';
import {readFile} from 'node:fs/promises';
import {isPythonModel,registerModelMenu} from '../extensions/vscode/src/model-menu.js';

test('only module-level model entry points are offered, not helpers or documentation',()=>{
 for(const code of ['def build(ctx):\n return model','result = cq.Workplane()','result: cq.Shape = shape','build = imported_factory','\uFEFFdef build(ctx): pass'])expect(isPythonModel(code)).toBe(true);
 for(const code of ['from . import surface_tools\ndef panel(n): pass','# def build(ctx): pass\ndef make(): pass','"""Example:\ndef build(ctx): pass\nresult = box\n"""\ndef helper(): pass',"'''\nresult = box\n'''",'class Factory:\n def build(self): pass','def helper():\n result = shape','result == something','result: cq.Shape'])expect(isPythonModel(code)).toBe(false);
});

test('shipped platform helpers are hidden and their part entry points remain available',async()=>{
 const root=new URL('../examples/team3310-rebuilt/source/cad-assets/robot/native/',import.meta.url);
 expect(isPythonModel(await readFile(new URL('platforms.py',root),'utf8'))).toBe(false);
 expect(isPythonModel(await readFile(new URL('parts/p_bhr_2026_500_014_top_d26859488e35.py',root),'utf8'))).toBe(true);
});

const until=async predicate=>{for(let n=0;n<100;n++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}throw Error('Menu did not settle');};
test('Explorer index follows disk saves, external changes, deletions and disposal',async()=>{
 const files=new Map([['/robot/a.py','def build(ctx): pass'],['/robot/helper.py','def make(): pass']]);
 const uri=fsPath=>({scheme:'file',fsPath});let published=[],releaseRead;
 const events={};const subscribe=name=>fn=>{events[name]=fn;return {dispose(){delete events[name];}};};
 const context={subscriptions:[]};
 const vscode={RelativePattern:class{constructor(base,pattern){this.base=base;this.pattern=pattern;}},commands:{executeCommand:async(name,key,value)=>{expect(name).toBe('setContext');expect(key).toBe('cadcove.modelEntryPaths');published=value;}},workspace:{
  getWorkspaceFolder:u=>u.fsPath.startsWith('/robot/')?{uri:uri('/robot')}:undefined,
  workspaceFolders:[{uri:uri('/robot')}],
  findFiles:async()=>[...files.keys()].map(uri),
  fs:{stat:async u=>({type:files.has(u.fsPath)?1:2,size:files.get(u.fsPath)?.length??0}),readFile:async u=>{const text=files.get(u.fsPath);if(releaseRead)await new Promise(r=>{releaseRead.resolve=r;});if(text===undefined)throw Error('gone');return Buffer.from(text);}},
  createFileSystemWatcher:()=>({dispose(){},onDidCreate:subscribe('create'),onDidChange:subscribe('change'),onDidDelete:subscribe('delete')}),
  onDidSaveTextDocument:subscribe('save'),onDidChangeWorkspaceFolders:subscribe('folders')
 }};
 const menu=registerModelMenu(vscode,context);
 try{
  await until(()=>published.includes('/robot/a.py'));
  expect(published).not.toContain('/robot/helper.py');
  files.set('/robot/helper.py','result = shape');events.save({uri:uri('/robot/helper.py')});
  await until(()=>published.includes('/robot/helper.py'));
  files.set('/robot/helper.py','def make(): pass');events.change(uri('/robot/helper.py'));
  await until(()=>!published.includes('/robot/helper.py'));
  files.set('/robot/.venv/fake.py','def build(ctx): pass');events.create(uri('/robot/.venv/fake.py'));
  expect(menu.entries()).not.toContain('/robot/.venv/fake.py');
  files.set('/robot/new/part.py','def build(ctx): pass');await events.create(uri('/robot/new'));
  await until(()=>published.includes('/robot/new/part.py'));
  files.delete('/robot/new/part.py');events.delete(uri('/robot/new'));
  await until(()=>!published.includes('/robot/new/part.py'));
  releaseRead={};events.change(uri('/robot/a.py'));await until(()=>releaseRead.resolve);
  files.delete('/robot/a.py');events.delete(uri('/robot/a.py'));releaseRead.resolve();releaseRead=undefined;
  await until(()=>!published.includes('/robot/a.py'));expect(menu.entries()).toEqual([]);
 }finally{for(const disposable of context.subscriptions)disposable.dispose();}
});
