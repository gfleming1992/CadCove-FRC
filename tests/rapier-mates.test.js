import {test,expect} from 'bun:test';
import path from 'node:path';
test.skipIf(!process.env.CADCOVE_RAPIER_MATE_SOLVER)('Rapier shares mate validation and passes independent trajectory residuals',async()=>{
 const p=Bun.spawn([process.env.CADCOVE_PYTHON??'python3',path.join(import.meta.dir,'rapier-mates-native.py')],{stdout:'pipe',stderr:'pipe'});
 const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);
 if(code)throw Error(out+'\n'+err);expect(code).toBe(0);
},120000);
