import {test,expect} from 'bun:test';
import {PracticeControls,validatePracticeControls} from '../lib/practice-controls.js';
const actions=[{id:'collect',label:'Collect',kind:'pulse',group:'mode',binding:{port:0,button:2}},{id:'stow',label:'Stow',kind:'pulse',group:'mode',binding:{port:0,button:1}},{id:'shoot',label:'Shoot',kind:'hold',allowedStates:['COLLECT'],binding:{port:0,axis:3}}];
test('pulses reach the operator without changing driving, then return to neutral',()=>{
 const controls=new PracticeControls(actions),driver={port:1,axes:[0,-.65,0,0,0,0],buttons:0,pov:-1};
 controls.press('collect',10);expect(controls.merge([driver],10.1,'COLLECT')).toEqual([driver,{port:0,axes:[0,0,0,0,0,0],buttons:2,pov:-1}]);
 expect(controls.merge([driver],10.13,'COLLECT')).toEqual([driver]);expect(driver.axes[1]).toBe(-.65);
});
test('hold release, mode eligibility, stop and competing modes clear virtual input',()=>{
 const controls=new PracticeControls(actions);controls.press('shoot',0);expect(controls.merge([],1,'COLLECT')[0].axes[3]).toBe(1);
 controls.release('shoot');expect(controls.merge([],2,'COLLECT')).toEqual([]);
 controls.press('shoot',3);expect(controls.merge([],3,'DEFENCEIN')).toEqual([]);
 controls.press('collect',4);controls.press('stow',4.01);expect(controls.merge([],4.02,'COLLECT')[0].buttons).toBe(1);
 controls.clear();expect(controls.merge([],4.03,'COLLECT')).toEqual([]);
});
test('virtual input merges into a real operator pad without mutating it',()=>{
 const controls=new PracticeControls(actions),pad={port:0,axes:[.1,.2,.3,.4,.5,.6],buttons:8,pov:90};controls.press('shoot',0);controls.press('collect',0);
 const result=controls.merge([pad],0,'COLLECT');expect(result[0].buttons).toBe(10);expect(result[0].axes).toEqual([.1,.2,.3,1,.5,.6]);expect(pad.axes[3]).toBe(.4);
});
test('invalid ports, duplicate controls and non-trigger axes are rejected',()=>{
 for(const list of [[...actions,actions[0]],[{...actions[0],binding:{port:4,button:1}}],[{...actions[0],binding:{port:0,axis:0}}]])expect(()=>validatePracticeControls(list)).toThrow();
 expect(validatePracticeControls()).toEqual([]);
});
