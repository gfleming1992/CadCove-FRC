import assert from 'node:assert/strict';
import {verifyMatchRendering} from './match-render-check.js';
import {rm} from 'node:fs/promises';
import {chromium} from 'playwright';
import {matchFixture} from './match-fixture.js';
import {startMatchServer} from '../lib/match-server.js';
import {prepareMatchVisuals} from '../lib/match-visuals.js';
import {prepareMatchAssets} from '../lib/match-assets.js';
const fixture=await matchFixture(),commands=[];
await prepareMatchVisuals({robot:fixture.root+'/robot',field:fixture.root+'/field',output:fixture.root+'/visuals'});
fixture.assets=await prepareMatchAssets({robot:fixture.root+'/visuals/robot',field:fixture.root+'/visuals/field',bindings:fixture.root+'/bindings.json'},fixture.robots,fixture.assets.manifest.bodyIds);
const server=await startMatchServer({...fixture,sendControls:async(id,command)=>commands.push({id,...command})});
const browser=await chromium.launch({channel:process.platform==='darwin'?'chrome':undefined,headless:true,args:['--enable-unsafe-webgpu',...(process.platform==='darwin'?['--use-angle=metal']:[])]});
try{
 const page=await browser.newPage({viewport:{width:1100,height:750}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(server.urls.drivers.r0);await page.waitForFunction(()=>window.cadcoveMatch?.ready,{},{timeout:30000});
 const initial=await page.evaluate(()=>({camera:JSON.stringify(cadcoveMatch.viewer.camera),x:cadcoveMatch.state.bodies['r0/chassis'].position[0],sequence:cadcoveMatch.state.sequence}));
 await page.locator('#follow').uncheck();await page.locator('#enable').click();await page.keyboard.down('KeyW');await page.waitForTimeout(100);
 assert(commands.some(c=>c.id==='r0'&&c.mode==='teleop'&&c.controllers[0].axes[1]===-1));
 assert.equal(await page.evaluate(()=>cadcoveMatch.state.bodies['r0/chassis'].position[0]),initial.x,'inputs cannot move client bodies');
 fixture.coordinator.snapshot={...fixture.coordinator.snapshot,tick:10,time:.05,bodies:{...fixture.coordinator.snapshot.bodies,'r0/chassis':{position:[3,0,.2],quaternion:[0,0,0,1]}}};
 await page.waitForFunction(()=>cadcoveMatch.state.tick===10);const advanced=await page.evaluate(()=>({camera:JSON.stringify(cadcoveMatch.viewer.camera),x:cadcoveMatch.state.bodies['r0/chassis'].position[0]}));
 assert.equal(advanced.x,3);assert.equal(advanced.camera,initial.camera);await page.keyboard.up('KeyW');await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>cadcoveMatch.state.bodies['r0/chassis'].position[0]),3,'no extrapolation between snapshots');
 await page.locator('#disable').click();await page.waitForTimeout(50);assert.equal(commands.at(-1).mode,'disabled');
 // A cache hit must still match the exact manifest hash. All three instances
 // are rendered from preloaded geometry; no server rendering/capture exists.
 assert.equal(await page.evaluate(()=>cadcoveMatch.viewer.logicalInstanceCount),3);
 assert.equal(await page.evaluate(()=>cadcoveMatch.viewer.instanceCount),12);
 const gpu=await page.evaluate(verifyMatchRendering);assert.equal(gpu.checked,12);assert.equal(gpu.bodySlots,3);
 assert.equal(errors.length,0);
 await page.close();await Bun.sleep(50);assert.equal(commands.at(-1).mode,'disabled');
 console.log(JSON.stringify({ok:true,checks:['asset preload','server-only movement','hold between updates','camera preserved','keyboard routing','disable and disconnect','WebGPU rendering','LOD preload and shared transforms'],commands:commands.length}));
}finally{await browser.close();await server.close();await rm(fixture.root,{recursive:true,force:true});}
