// Export the generic core from a committed revision. Never edit the exported
// files in place: update the generic repository and refresh this pin instead.
import path from 'node:path';
import {mkdir, writeFile, lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const [source, revision] = process.argv.slice(2);
if (!source || !/^[a-f0-9]{40}$/.test(revision || '')) throw Error('Usage: bun scripts/vendor-cad-core.js SOURCE_REPOSITORY FULL_COMMIT');
const target = path.resolve(import.meta.dir, '../vendor/cad-core');
try { await lstat(target); throw Error('Export already exists; review/remove it explicitly before updating the pinned core'); } catch (e) { if(e.code !== 'ENOENT') throw e; }
async function git(args) {
 const p=Bun.spawn(['git','-C',path.resolve(source),...args],{stdout:'pipe',stderr:'pipe'});
 const [bytes,err,code]=await Promise.all([new Response(p.stdout).arrayBuffer(),new Response(p.stderr).text(),p.exited]);
 if(code)throw Error(err);return Buffer.from(bytes);
}
const all=(await git(['ls-tree','-r','--name-only',revision])).toString().trim().split('\n');
const selected=all.filter(f=>f.startsWith('src/native/')||[
 'LICENSE','index.html','src/vscode-main.js','src/hosts/vscode.js',
 'src/core/viewer.js','src/core/assembly-viewer.js','src/core/assembly-capture.js',
 'src/core/scene-cache.js','src/core/scene-capture.js','src/core/mesh.js','src/core/revision.js','src/core/source-limits.js',
 'extensions/vscode/src/extension.js','extensions/vscode/src/project-files.js','extensions/vscode/src/step-source.js',
 'tests/vscode-host.test.js','tests/native-cad.test.js','tests/native-session.test.js','docs/NATIVE-CADQUERY.md'
].includes(f));
const files={};
for(const file of selected){const bytes=await git(['show',`${revision}:${file}`]);const out=path.join(target,file);await mkdir(path.dirname(out),{recursive:true});await writeFile(out,bytes);files[file]=createHash('sha256').update(bytes).digest('hex');}
await writeFile(path.join(target,'upstream.json'),JSON.stringify({schema:1,project:'instantcad-local',revision,policy:'Update upstream and regenerate; no downstream edits',files},null,2)+'\n');
console.log(JSON.stringify({target,revision,files:selected.length}));
