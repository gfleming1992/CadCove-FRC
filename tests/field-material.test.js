import {test,expect} from 'bun:test';
import path from 'node:path';
test.skipIf(!process.env.CADCOVE_PYTHON)('native field import retains STEP alpha and appearance-only refresh preserves geometry',async()=>{
 const p=Bun.spawn([process.env.CADCOVE_PYTHON,path.join(import.meta.dir,'field-material-native.py')],{stdout:'pipe',stderr:'pipe'});
 const [stdout,stderr,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);
 expect(code,stdout+'\n'+stderr).toBe(0);expect(JSON.parse(stdout).rgbaRoundtrip).toBe(true);
},60000);
