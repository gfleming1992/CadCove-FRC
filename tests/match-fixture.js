import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {encodeScene} from '../vendor/cad-core/src/core/mesh.js';
import {sha256,prepareMatchAssets} from '../lib/match-assets.js';
export async function matchFixture(){
 const root=await mkdtemp(path.join(tmpdir(),'cadcove-match-assets-')),identity=[1,0,0,0,0,1,0,0,0,0,1,0];
 const p={id:'part',name:'Part',color:'#428ed1',positions:new Float32Array([-200,-200,0,200,-200,0,0,200,0]),normals:new Float32Array([0,0,1,0,0,1,0,0,1]),indices:new Uint32Array([0,1,2])},mesh=encodeScene({parts:[p]});
 for(const kind of ['robot','field']){const dir=path.join(root,kind);await mkdir(dir);await writeFile(path.join(dir,'mesh.bin'),new Uint8Array(mesh));await writeFile(path.join(dir,'catalog.json'),JSON.stringify({part:{mesh:'mesh.bin',meshSha256:sha256(new Uint8Array(mesh))},unused:{name:'Source without a tessellation'}}));await writeFile(path.join(dir,'instances.json'),JSON.stringify([{id:'part',asset:'part',color:p.color,transform:identity}]));}
 const bindings={schema:1,start:[0,0,0],fieldOrigin:[0,0,0],robot:{part:{body:'chassis',local:identity}},field:{part:{body:'ball',local:identity}}};await writeFile(path.join(root,'bindings.json'),JSON.stringify(bindings));
 const robots=[{id:'r0',prefix:'r0/'},{id:'r1',prefix:'r1/'}],bodyIds=['ball','r0/chassis','r1/chassis'];
 const assets=await prepareMatchAssets({robot:path.join(root,'robot'),field:path.join(root,'field'),bindings:path.join(root,'bindings.json')},robots,bodyIds);
 const body=x=>({position:[x,0,.2],quaternion:[0,0,0,1]});
 return {root,assets,robots,coordinator:{snapshot:{tick:0,time:0,bodies:{ball:body(0),'r0/chassis':body(1),'r1/chassis':body(2)}},failure:null}};
}
