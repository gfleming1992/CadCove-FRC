import assert from 'node:assert/strict';
import {chromium} from 'playwright';

// Exercise real pointer capture and browser defaults without loading a CAD kernel.
const server = Bun.serve({port:0, fetch(request) {
  if (new URL(request.url).pathname === '/viewer.js') return new Response(Bun.file(new URL('../src/core/viewer.js', import.meta.url)));
  return new Response(`<style>body{margin:0}canvas{width:800px;height:600px}</style><canvas tabindex="0"></canvas><script type="module">import {Viewer} from '/viewer.js';window.viewer=new Viewer(document.querySelector('canvas'));</script>`, {headers:{'content-type':'text/html'}});
}});
const browser = await chromium.launch({headless:true, ...(process.platform === 'darwin' ? {executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'} : {})});
try {
  const page = await browser.newPage();
  await page.goto(`http://localhost:${server.port}`);
  await page.waitForFunction(() => window.viewer);
  const camera = () => page.evaluate(() => structuredClone(viewer.camera));
  const strokes = () => page.locator('[data-cad-marker] polyline').count();
  async function drag(button, x=100, y=100) {
    await page.mouse.move(x,y);
    await page.mouse.down({button});
    await page.mouse.move(x+80,y+60,{steps:8});
    await page.mouse.up({button});
  }
  const initial = await camera();
  await drag('middle');
  await drag('middle',250,200);
  assert.equal(await strokes(),2);
  assert.deepEqual(await camera(),initial,'middle drag must not move the camera');
  assert.equal(await page.locator('[data-cad-marker] polyline').first().getAttribute('stroke'),'#ff3030');
  await drag('right');
  assert.equal(await strokes(),0,'pan clears all strokes');
  assert.notDeepEqual((await camera()).target,initial.target,'right drag still pans');
  await drag('middle');
  await drag('left');
  assert.equal(await strokes(),0,'orbit clears marks');
  assert.notEqual((await camera()).yaw,initial.yaw);
  await drag('middle');
  await page.mouse.wheel(0,100);
  await page.waitForFunction(() => !document.querySelector('[data-cad-marker] polyline'));
  await drag('middle');
  await page.keyboard.press('Escape');
  assert.equal(await strokes(),0);
  await drag('middle');
  await page.evaluate(() => viewer.resize());
  assert.equal(await strokes(),0);
  await drag('middle');
  await page.evaluate(() => { viewer.center=[0,0,0]; viewer.fit(); });
  assert.equal(await strokes(),0,'fit clears marks');
  await drag('middle');
  // Exercise scene replacement with a minimal mesh and a stub GPU device.
  await page.evaluate(() => {
    viewer.device={createBuffer(){return {destroy(){}}},queue:{writeBuffer(){}}};
    viewer.request=() => {};
    viewer.setScene({parts:[{id:'triangle',color:'#ffffff',positions:new Float32Array([0,0,0,1,0,0,0,1,0]),normals:new Float32Array(9),indices:new Uint32Array([0,1,2])}]});
  });
  assert.equal(await strokes(),0,'new scene clears marks');
  await page.mouse.move(100,100);
  await page.mouse.down({button:'middle'});
  await page.mouse.move(900,650);
  await page.mouse.up({button:'middle'});
  assert.equal(await page.evaluate(() => viewer.markerStroke),null,'release outside canvas ends drawing');
  await page.evaluate(() => viewer.canvas.dispatchEvent(new PointerEvent('lostpointercapture',{pointerId:1})));
  await drag('middle');
  assert.equal(await strokes(),2,'drawing works after capture loss');
  console.log('PASS: multiple strokes, camera isolation, right pan, orbit/zoom/resize clearing, Escape, outside release');
} finally {
  await browser.close();
  server.stop(true);
}
