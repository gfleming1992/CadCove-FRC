import {test,expect} from 'bun:test';
import {pickPart} from '../src/core/selection.js';
const triangle={positions:new Float32Array([-1,-1,0,1,-1,0,0,1,0]),indices:new Uint32Array([0,1,2])};
test('picks nearest visible triangle, not just a bounding box',()=>{
 const nodes=[{id:'back',part:triangle},{id:'front',part:triangle,transform:[1,0,0,0,0,1,0,0,0,0,1,2]}];
 expect(pickPart(nodes,[0,0,5],[0,0,-1])).toBe('front');
 expect(pickPart(nodes,[.9,.9,5],[0,0,-1])).toBe(null);
 expect(pickPart(nodes,[0,0,5],[0,0,1])).toBe(null);
});
test('picks transformed, uniformly scaled instances in their current pose',()=>{
 const nodes=[{id:'moved',part:triangle,transform:[0,-2,0,10,2,0,0,0,0,0,2,3]}];
 expect(pickPart(nodes,[10,0,8],[0,0,-1])).toBe('moved');
 expect(pickPart(nodes,[0,0,8],[0,0,-1])).toBe(null);
});
