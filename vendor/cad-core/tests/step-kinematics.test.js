import {test,expect} from 'bun:test';
test.skipIf(!process.env.CADCOVE_STEP_PYTHON)('OCCT preserves standard kinematics references, frames, limits and unsupported entities',async()=>{
 const p=Bun.spawn([process.env.CADCOVE_STEP_PYTHON,new URL('./step-kinematics-native.py',import.meta.url).pathname],{stdout:'pipe',stderr:'pipe'});
 const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);
 expect({code,err}).toEqual({code:0,err:''});expect(out).toContain('inspection tests passed');
},30000);
