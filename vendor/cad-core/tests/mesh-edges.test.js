import {test,expect} from 'bun:test';
import {meshEdges} from '../src/core/mesh-edges.js';
test('CAD edges suppress triangle diagonals and weld smooth face seams',()=>{
 const p={positions:new Float32Array([0,0,0,1,0,0,1,1,0,0,0,0,1,1,0,0,1,0]),normals:new Float32Array(Array(6).fill([0,0,1]).flat()),indices:new Uint32Array([0,1,2,3,4,5])};
 expect(meshEdges(p).length).toBe(8); // Four outline edges, no diagonal.
 expect(meshEdges(p)).toBe(meshEdges(p));
 const sharp={...p,normals:p.normals.slice()};sharp.normals.set([0,1,0,0,1,0,0,1,0],9);
 expect(meshEdges(sharp).length).toBe(10); // Normal discontinuity keeps the crease.
});
test('separate nearby holes are not welded together',()=>{
 const p={positions:new Float32Array([0,0,0,1,0,0,0,1,0,.01,0,0,1.01,0,0,.01,1,0]),normals:new Float32Array(Array(6).fill([0,0,1]).flat()),indices:new Uint32Array([0,1,2,3,4,5])};
 expect(meshEdges(p).length).toBe(12);
});
