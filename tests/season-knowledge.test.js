import {test,expect} from 'bun:test';
import {mkdtemp,writeFile,readFile,mkdir,rm,symlink,readdir} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {importSeasonKnowledge,searchSeasonKnowledge} from '../lib/season-knowledge.js';
import {initializeToolbox} from '../lib/toolbox-project.js';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function fixture(fn){const root=await mkdtemp(path.join(os.tmpdir(),'cadcove-season-'));try{
 const pdf=path.join(root,'manual.pdf'),packFile=path.join(root,'season.json'),pagesFile=path.join(root,'pages.json');
 const bytes=Buffer.from('%PDF-1.4\nSynthetic local test; not FIRST content.\n');await writeFile(pdf,bytes);
 await writeFile(packFile,JSON.stringify({schema:1,id:'frc-2026-fixture',year:2026,game:'Fixture',language:'en',manualUrl:'https://example.invalid/manual.pdf',updatesUrl:'https://example.invalid/updates.pdf',sourcePage:'https://example.invalid/season'}));
 await writeFile(pagesFile,JSON.stringify({sourceSha256:sha(bytes),pages:['Test requirement R101: inspect the fixture bumper.','R202: wheel attachment is checked separately.']}));
 await fn({workspace:root,packFile,pdf,pagesFile,revision:'fixture-only'});
 }finally{await rm(root,{recursive:true,force:true});}}
test('imports immutable page-cited revisions, searches rules, and does not select a runtime or season silently',()=>fixture(async o=>{
 await initializeToolbox({workspace:o.workspace});const config=await readFile(path.join(o.workspace,'.cadcove/frc.json'),'utf8');
 const a=await importSeasonKnowledge(o),b=await importSeasonKnowledge(o);expect(a.reused).toBe(false);expect(b.reused).toBe(true);expect(a.directory).toBe(b.directory);
 const found=await searchSeasonKnowledge({directory:a.directory,query:'R202 wheel'});expect(found.hits[0].page).toBe(2);expect(found.sourceHash).toBe(sha(await readFile(o.pdf)));
 expect(await readFile(path.join(o.workspace,'.cadcove/frc.json'),'utf8')).toBe(config);
 const c=await importSeasonKnowledge({...o,revision:'revised'});expect(c.directory).not.toBe(a.directory);expect((await searchSeasonKnowledge({directory:a.directory,query:'bumper'})).hits[0].page).toBe(1);
 expect(await readFile(path.join(o.workspace,'.cadcove/knowledge/.gitignore'),'utf8')).toBe('*\n!.gitignore\n');
}));
test('rejects wrong PDF extraction identity and path traversal in season IDs before writing corpus',()=>fixture(async o=>{
 await writeFile(o.pagesFile,JSON.stringify({sourceSha256:'0'.repeat(64),pages:['test']}));await expect(importSeasonKnowledge(o)).rejects.toThrow('identify this PDF');
 const pack=JSON.parse(await readFile(o.packFile));pack.id='../../escape';await writeFile(o.packFile,JSON.stringify(pack));await expect(importSeasonKnowledge(o)).rejects.toThrow('descriptor');expect((await readdir(o.workspace)).includes('.cadcove')).toBe(false);
}));
test('changed knowledge fails closed instead of returning stale or corrupted rule text',()=>fixture(async o=>{
 const a=await importSeasonKnowledge(o);await writeFile(path.join(a.directory,'page-0001.md'),'changed rule');
 await expect(searchSeasonKnowledge({directory:a.directory,query:'rule'})).rejects.toThrow('checksum');await expect(importSeasonKnowledge(o)).rejects.toThrow('checksum');
}));
test('ranks substantive pages, matches whole rule IDs, and makes every result reachable',()=>fixture(async o=>{
 const pages=[
  'Contents: bumper rules ................................ 12. '+('Unrelated overview. '.repeat(80)),
  ...Array.from({length:10},(_,i)=>`Fixture page ${i}: a bumper appears in this operational example.`),
  'R202: Bumper construction. Inspect bumper material, bumper attachment, and bumper support. Check the bumper before use.',
  'R2020: This is a different fictional rule identifier.',
 ];
 await writeFile(o.pagesFile,JSON.stringify({sourceSha256:sha(await readFile(o.pdf)),pages}));
 const {directory}=await importSeasonKnowledge(o);
 const first=await searchSeasonKnowledge({directory,query:'bumper',limit:5});
 expect(first.hits[0].page).toBe(12);expect(first.hits[0].ruleIds).toEqual(['R202']);
 expect(first.totalMatches).toBe(12);expect(first.nextOffset).toBe(5);
 const second=await searchSeasonKnowledge({directory,query:'bumper',offset:String(first.nextOffset),limit:'5'});
 const last=await searchSeasonKnowledge({directory,query:'bumper',offset:second.nextOffset,limit:5});
 const all=[...first.hits,...second.hits,...last.hits];
 expect(new Set(all.map(h=>h.page)).size).toBe(12);expect(last.nextOffset).toBeNull();
 expect(all.every(h=>h.pdf.endsWith('#page='+h.page))).toBe(true);
 const exact=await searchSeasonKnowledge({directory,query:'R202'});expect(exact.hits.map(h=>h.page)).toEqual([12]);
 const empty=await searchSeasonKnowledge({directory,query:'unmatched'});expect(empty.hits).toEqual([]);expect(empty.nextOffset).toBeNull();
 for(const options of [{limit:0},{limit:21},{limit:1.2},{offset:-1},{offset:'1e2'},{offset:''}])await expect(searchSeasonKnowledge({directory,query:'bumper',...options})).rejects.toThrow('must be an integer');
}));
test('does not follow output symlinks or overwrite a conflicting ignore policy',()=>fixture(async o=>{
 const external=path.join(o.workspace,'outside');await mkdir(external);await mkdir(path.join(o.workspace,'.cadcove'));await symlink(external,path.join(o.workspace,'.cadcove/knowledge'),'dir');
 await expect(importSeasonKnowledge(o)).rejects.toThrow('symlinks');expect(await readdir(external)).toEqual([]);
 await rm(path.join(o.workspace,'.cadcove/knowledge'));await mkdir(path.join(o.workspace,'.cadcove/knowledge'));await writeFile(path.join(o.workspace,'.cadcove/knowledge/.gitignore'),'custom');await expect(importSeasonKnowledge(o)).rejects.toThrow('ignore policy');
}));
test('installed skill references resolve and init preserves customized skills',()=>fixture(async o=>{
 await initializeToolbox({workspace:o.workspace});const dir=path.join(o.workspace,'.cadcove/skills');
 for(const name of await readdir(dir)){if(name==='references')continue;const file=path.join(dir,name,'SKILL.md'),text=await readFile(file,'utf8');for(const match of text.matchAll(/`(\.\.\/references\/[^`]+)`/g))expect((await readFile(path.resolve(path.dirname(file),match[1]))).length).toBeGreaterThan(0);}
 const skill=path.join(dir,'frc-ctre-controls/SKILL.md');await writeFile(skill,'Team custom guidance');await expect(initializeToolbox({workspace:o.workspace})).rejects.toThrow('Refusing to overwrite');expect(await readFile(skill,'utf8')).toBe('Team custom guidance');
}));
