import {test,expect} from 'bun:test';
import path from 'node:path';
test.skipIf(!process.env.CADCOVE_SKETCH_PYTHON)('PlaneGCS plate edits retain checked references and reject conflicting constraints',async()=>{
 const p=Bun.spawn([process.env.CADCOVE_SKETCH_PYTHON,path.join(import.meta.dir,'sketch-native.py')],{stdout:'pipe',stderr:'pipe'});
 const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);
 if(code)throw Error(out+'\n'+err);expect(code).toBe(0);
},60000);
