import {test,expect} from 'bun:test';
import path from 'node:path';
test('solver independent mate contract validation',async()=>{
 const p=Bun.spawn([process.env.CADCOVE_PYTHON??'python3',path.join(import.meta.dir,'mate-contract-native.py')],{stdout:'pipe',stderr:'pipe'});
 const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);
 if(code)throw Error(out+'\n'+err);expect(code).toBe(0);
},90000);
