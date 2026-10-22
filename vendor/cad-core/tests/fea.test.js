import {test,expect} from 'bun:test';
test.skipIf(!process.env.CADCOVE_PYTHON)('native FEA geometry and optional real backend',async()=>{
 const p=Bun.spawn([process.env.CADCOVE_PYTHON,new URL('./fea-native.py',import.meta.url).pathname],{stdout:'pipe',stderr:'pipe'});
 const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);if(code)throw Error(out+err);expect(code).toBe(0);
},300000);
