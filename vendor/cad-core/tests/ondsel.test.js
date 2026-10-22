import {test,expect} from 'bun:test';
import path from 'node:path';
test('headless mate adapter validation and optional native solver',async()=>{
 const p=Bun.spawn([process.env.CADCOVE_PYTHON??'python3',path.join(import.meta.dir,'ondsel-native.py')],{stdout:'pipe',stderr:'pipe'});
 const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);
 if(code)throw Error(out+'\n'+err);expect(code).toBe(0);
},90000);
