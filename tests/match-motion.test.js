import {test,expect} from 'bun:test';
import {BodyTransforms,writeMatrix,renderDimensions,AdaptiveResolution} from '../web/match-motion.js';
import {compose,quaternionMatrix} from '../lib/transforms.js';
import {gpuMatrix} from '../web/simulation-scene.js';
test('body upload composed with fixed CAD offset matches authoritative placement including units and rotation',()=>{
 const b=new BodyTransforms(['arm','chassis','arm']),q=[.2,.3,.4,Math.sqrt(.71)],pose={position:[3,-2,.7],quaternion:q},bodies={arm:pose,chassis:{position:[0,0,0],quaternion:[0,0,0,1]}};
 expect(b.update(bodies)).toBe(2);expect(b.matrices.length).toBe(48);expect(b.update(bodies)).toBe(0);
 const local=[0,-1,0,.3,1,0,0,-.1,0,0,1,.2],packed=new Float32Array(16);writeMatrix(packed,0,gpuMatrix(local));
 const expected=gpuMatrix(compose(quaternionMatrix(q,pose.position),local)),a=b.matrices.subarray(b.slots.get('arm')*16,b.slots.get('arm')*16+16);
 for(let r=0;r<3;r++)for(let c=0;c<4;c++){let value=0;for(let k=0;k<4;k++)value+=a[k*4+r]*packed[c*4+k];expect(value).toBeCloseTo(expected[r*4+c],6);}
 expect(b.update({...bodies,arm:{...pose,position:[4,-2,.7]}})).toBe(1);
 expect(()=>new BodyTransforms(['missing']).update({})).toThrow('Missing');
 expect(()=>b.update({...bodies,arm:{...pose,quaternion:[0,0,0,2]}})).toThrow('rigid');
});
test('client pixel budgets respect aspect ratio on high DPI displays',()=>{
 expect(renderDimensions(1920,1080,2)).toEqual([1920,1080]);expect(renderDimensions(1920,1080,2,'performance')).toEqual([1280,720]);
 const [w,h]=renderDimensions(3440,1440,2);expect(w*h).toBeLessThanOrEqual(1920*1080);expect(w/h).toBeCloseTo(3440/1440,2);
 expect(renderDimensions(0,0,2)).toEqual([1,1]);expect(()=>renderDimensions(100,100,1,'unknown')).toThrow();
});
test('adaptive resolution ignores spikes, reduces sustained expensive frames and recovers conservatively',()=>{
 const a=new AdaptiveResolution();a.observe(100);for(let i=0;i<100;i++)a.observe(15);expect(a.scale).toBe(1);
 for(let i=0;i<30;i++)a.observe(25);expect(a.scale).toBe(.85);
 for(let i=0;i<179;i++)a.observe(8);expect(a.scale).toBe(.85);a.observe(8);expect(a.scale).toBe(1);
 for(let i=0;i<1000;i++)a.observe(100);expect(a.scale).toBe(.6);
});
