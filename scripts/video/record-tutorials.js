import {readFile,writeFile,mkdir,cp,readdir} from 'node:fs/promises';
import path from 'node:path';
// Reuse the proven isolated Linux editor harness with a task-specific driver.
const root=process.cwd(),mode=process.env.CADCOVE_RECORD_MODE??'edit';
let script=await readFile('scripts/video/record-cloud.js','utf8');
script=script.replace("out=path.join(root,'artifacts/quickstart')",`out=path.join(root,'artifacts/tutorial-${mode}')`)
 .replace("workspace=path.join(profile,'Amarillo-CAD')",`workspace=path.join(profile,'${mode==='simulation'?'Amarillo-REBUILT':'Amarillo-CAD'}')`)
 .replace("'scripts/video/record-driver.cjs'","'scripts/video/tutorial-driver.cjs'")
 .replace("'editor.fontSize':20", "'editor.fontSize':22,'terminal.integrated.fontSize':20,'workbench.secondarySideBar.defaultVisibility':'hidden'");
if(mode==='simulation'){
 script=script.replace("await cp(path.join(root,'examples/team3310-rebuilt/source/cad-assets/robot'),path.join(workspace,'cad-assets/robot'),{recursive:true});", "await cp(path.join(root,'build/Amarillo-REBUILT'),workspace,{recursive:true});");
}
await writeFile('scripts/video/.tutorial-harness.js',script);
await import('./.tutorial-harness.js');
