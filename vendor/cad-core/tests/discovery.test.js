import {test,expect} from 'bun:test';
import path from 'node:path';
const python=process.env.CADCOVE_PYTHON;
(python?test:test.skip)('native discovery distinguishes measured axes from intent and invalidates cached evidence',async()=>{
 const proc=Bun.spawn([python,path.resolve(import.meta.dir,'discovery-native.py')],{stdout:'pipe',stderr:'pipe'});
 const [out,err,code]=await Promise.all([new Response(proc.stdout).text(),new Response(proc.stderr).text(),proc.exited]);
 expect({out,err,code}).toMatchObject({code:0});
},30000);
