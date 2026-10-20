const subtract = (a, b) => a.map((x, i) => x - b[i]),
  dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0),
  cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  unit = (a) => {
    const l = Math.hypot(...a) || 1;
    return a.map((v) => v / l);
  };
function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}
const shader = `struct View {mvp:mat4x4f}; @group(0) @binding(0) var<uniform> view:View;
struct Out {@builtin(position) position:vec4f,@location(0) normal:vec3f,@location(1) color:vec3f};
@vertex fn vs(@location(0) p:vec3f,@location(1) n:vec3f,@location(2) color:vec3f)->Out {var o:Out;o.position=view.mvp*vec4f(p,1);o.normal=n;o.color=color;return o;}
@fragment fn fs(o:Out,@builtin(front_facing) front:bool)->@location(0) vec4f {let n=normalize(o.normal)*select(-1.0,1.0,front);let key=max(dot(n,normalize(vec3f(-0.3,-0.6,1.0))),0.0);let fill=max(dot(n,normalize(vec3f(0.8,0.4,0.2))),0.0);let linear=pow(o.color,vec3f(2.2))*(0.42+0.55*key+0.18*fill);return vec4f(pow(linear,vec3f(1.0/2.2)),1);}`;
export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.camera = { target: [35, 20, 20], distance: 160, yaw: 1.0, pitch: 1.0 };
    this.radius = 50;
    this.pending = false;
    this.pointers = new Map();
    this.frames = 0;
    this.installControls();
  }
  async init() {
    if (!navigator.gpu)
      throw Error(
        "WebGPU is unavailable. Open this app in a recent Chrome or Edge with GPU acceleration.",
      );
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw Error("No WebGPU adapter is available");
    this.device = await adapter.requestDevice();
    this.context = this.canvas.getContext("webgpu");
    const format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format,
      alphaMode: "opaque",
    });
    const module = this.device.createShaderModule({ code: shader });
    this.pipeline = await this.device.createRenderPipelineAsync({
      layout: "auto",
      vertex: {
        module,
        entryPoint: "vs",
        buffers: [
          {
            arrayStride: 36,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x3" },
              { shaderLocation: 1, offset: 12, format: "float32x3" },
              { shaderLocation: 2, offset: 24, format: "float32x3" },
            ],
          },
        ],
      },
      fragment: { module, entryPoint: "fs", targets: [{ format }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: {
        format: "depth32float",
        depthWriteEnabled: true,
        depthCompare: "greater",
      },
      multisample: { count: 4 },
    });
    this.uniform = this.device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.group = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniform } }],
    });
    this.resize();
    new ResizeObserver(() => this.resize()).observe(this.canvas);
    this.device.lost.then((info) => {
      document.getElementById("status").textContent =
        `GPU device lost: ${info.message}. Reload to restore the cached scene.`;
    });
    return this;
  }
  resize() {
    this.clearMarkers();
    if (!this.device) return;
    const ratio = Math.min(devicePixelRatio || 1, 2),
      w = Math.max(1, Math.round(this.canvas.clientWidth * ratio)),
      h = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width === w && this.canvas.height === h && this.depth)
      return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.depth?.destroy();
    this.multisample?.destroy();
    this.depth = this.device.createTexture({
      size: [w, h],
      sampleCount: 4,
      format: "depth32float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.multisample = this.device.createTexture({
      size: [w, h],
      sampleCount: 4,
      format: navigator.gpu.getPreferredCanvasFormat(),
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.request();
  }
  setScene(scene, fit = false) {
    // Stable buckets keep draw count small while allowing topology changes in
    // one component without repacking/uploading every other component.
    const groups=Array.from({length:32},()=>[]);
    for(const part of scene.parts) {
      let key=2166136261;
      for(const c of part.id)key=Math.imul(key^c.charCodeAt(0),16777619);
      groups[(key>>>0)%groups.length].push(part);
    }
    const next=[],created=[];
    let uploadedBytes=0,reusedBatches=0;
    try {
      for(let b=0;b<groups.length;b++) {
        const parts=groups[b],old=this.batches?.[b];
        if(old && old.parts.length===parts.length && parts.every((p,i)=>{
          const q=old.parts[i];
          return p.id===q.id && p.positions===q.positions && p.normals===q.normals && p.indices===q.indices && p.color===q.color;
        })) {next.push(old);reusedBatches++;continue;}
        if(!parts.length){next.push(null);continue;}
        const vertices=parts.reduce((n,p)=>n+p.positions.length/3,0),count=parts.reduce((n,p)=>n+p.indices.length,0);
        const data=new Float32Array(vertices*9),indices=new Uint32Array(count),low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
        let vertex=0,index=0;
        for(const part of parts) {
          const color=[1,3,5].map(i=>parseInt(part.color.slice(i,i+2),16)/255);
          for(let n=0;n<part.positions.length/3;n++)for(let j=0;j<3;j++) {
            const p=part.positions[n*3+j];low[j]=Math.min(low[j],p);high[j]=Math.max(high[j],p);
            data[(vertex+n)*9+j]=p;data[(vertex+n)*9+3+j]=part.normals[n*3+j];data[(vertex+n)*9+6+j]=color[j];
          }
          for(const value of part.indices)indices[index++]=value+vertex;
          vertex+=part.positions.length/3;
        }
        if(!vertices)throw Error('The scene has no visible triangles');
        const batch={parts,count,low,high,bytes:data.byteLength+indices.byteLength};
        created.push(batch);
        batch.vertices=this.device.createBuffer({size:data.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
        batch.indices=this.device.createBuffer({size:indices.byteLength,usage:GPUBufferUsage.INDEX|GPUBufferUsage.COPY_DST});
        this.device.queue.writeBuffer(batch.vertices,0,data);this.device.queue.writeBuffer(batch.indices,0,indices);
        uploadedBytes+=batch.bytes;next.push(batch);
      }
      if(!next.some(b=>b?.count))throw Error('The scene has no visible triangles');
    }catch(error){for(const b of created){b.vertices?.destroy();b.indices?.destroy();}throw error;}
    for(let i=0;i<(this.batches?.length??0);i++)if(this.batches[i] && this.batches[i]!==next[i]) {
      this.batches[i].vertices.destroy();this.batches[i].indices.destroy();
    }
    this.batches=next;
    const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
    for(const b of next)if(b)for(let j=0;j<3;j++){low[j]=Math.min(low[j],b.low[j]);high[j]=Math.max(high[j],b.high[j]);}
    this.count=next.reduce((n,b)=>n+(b?.count??0),0);
    this.bounds={low,high};this.center=low.map((v,i)=>(v+high[i])/2);
    this.radius=Math.max(Math.hypot(...subtract(high,low))/2,0.001);
    this.gpuBytes=next.reduce((n,b)=>n+(b?.bytes??0),0);
    this.lastUpload={uploadedBytes,reusedBatches,rebuiltBatches:created.length,drawCalls:next.filter(Boolean).length};
    this.scene=scene;
    this.clearMarkers();
    // Never copy an earlier camera snapshot here: input can continue while the
    // worker builds. Keep the latest live rotation, pan, and zoom verbatim.
    if(fit)this.fit();
    this.request();
  }

  fit() {
    if (this.center) {
      this.camera.target = [...this.center];
      this.camera.distance =
        (this.radius * 1.15) /
        Math.sin(
          Math.atan(
            Math.tan(Math.PI / 8) *
              Math.min(1, this.canvas.clientWidth / this.canvas.clientHeight),
          ),
        );
      this.request();
    }
  }
  view(name) {
    const poses = {
      front: [-Math.PI / 2, Math.PI / 2],
      right: [0, Math.PI / 2],
      top: [-Math.PI / 2, 0.001],
      iso: [1, 1],
    };
    if (!poses[name]) throw Error("View must be front, right, top or iso");
    [this.camera.yaw, this.camera.pitch] = poses[name];
    this.request();
  }
  basis(camera = this.camera) {
    const c = camera,
      z = [
        Math.sin(c.pitch) * Math.cos(c.yaw),
        Math.sin(c.pitch) * Math.sin(c.yaw),
        Math.cos(c.pitch),
      ],
      x = unit(cross([0, 0, 1], z)),
      y = cross(z, x);
    return { x, y, z };
  }
  matrix({ camera = this.camera, width = this.canvas.width, height = this.canvas.height,
    center = this.center || camera.target, radius = this.radius } = {}) {
    const c = camera,
      { x, y, z } = this.basis(c),
      eye = c.target.map((v, i) => v + z[i] * c.distance),
      v = new Float32Array([
        x[0],
        y[0],
        z[0],
        0,
        x[1],
        y[1],
        z[1],
        0,
        x[2],
        y[2],
        z[2],
        0,
        -dot(x, eye),
        -dot(y, eye),
        -dot(z, eye),
        1,
      ]);
    const centerDistance = Math.hypot(
        ...subtract(eye, center),
      ),
      near = Math.max(
        0.0001,
        c.distance / 10000,
        centerDistance - radius * 1.8,
      ),
      far = Math.max(near + 1, centerDistance + radius * 2.5),
      f = 1 / Math.tan(Math.PI / 8),
      // Reversed floating-point depth keeps thin CAD layers distinguishable
      // across a large scene even with a close near plane. Near maps to 1.
      p = new Float32Array([
        f / (width / height),
        0,
        0,
        0,
        0,
        f,
        0,
        0,
        0,
        0,
        near / (far - near),
        -1,
        0,
        0,
        (near * far) / (far - near),
        0,
      ]);
    return multiply(p, v);
  }
  request() {
    if (this.markerCamera && this.markerCamera !== JSON.stringify(this.camera)) this.clearMarkers();
    if (this.pending || !this.device) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.render();
    });
  }
  render() {
    if (!this.depth) return;
    const device = this.device;
    device.queue.writeBuffer(this.uniform, 0, this.matrix());
    const encoder = device.createCommandEncoder(),
      pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this.multisample.createView(),
            resolveTarget: this.context.getCurrentTexture().createView(),
            loadOp: "clear",
            storeOp: "discard",
            clearValue: { r: 0.047, g: 0.065, b: 0.084, a: 1 },
          },
        ],
        depthStencilAttachment: {
          view: this.depth.createView(),
          depthClearValue: 0,
          depthLoadOp: "clear",
          depthStoreOp: "discard",
        },
      });
    this.draw(pass);
    pass.end();
    device.queue.submit([encoder.finish()]);
    this.frames++;
  }
  draw(pass) {
    if (!this.count) return;
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.group);
    for(const batch of this.batches??[])if(batch) {
      pass.setVertexBuffer(0,batch.vertices);
      pass.setIndexBuffer(batch.indices,'uint32');
      pass.drawIndexed(batch.count);
    }
  }
  pan(dx, dy) {
    const { x, y } = this.basis(),
      scale =
        (2 * this.camera.distance * Math.tan(Math.PI / 8)) /
        this.canvas.clientHeight;
    this.camera.target = this.camera.target.map(
      (v, i) => v + (-dx * x[i] + dy * y[i]) * scale,
    );
  }
  zoom(factor) {
    this.camera.distance = Math.min(
      this.radius * 1e5,
      Math.max(this.radius * 0.015, this.camera.distance * factor),
    );
  }
  markerPoint(e) {
    const r = this.canvas.getBoundingClientRect();
    if (!this.markerOverlay) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("aria-hidden", "true");
      svg.dataset.cadMarker = "";
      svg.style.cssText = "position:fixed;pointer-events:none;overflow:hidden;z-index:1";
      this.canvas.after(svg);
      this.markerOverlay = svg;
    }
    Object.assign(this.markerOverlay.style, {
      left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
    });
    this.markerOverlay.setAttribute("viewBox", `0 0 ${r.width} ${r.height}`);
    return `${e.clientX - r.left},${e.clientY - r.top}`;
  }
  clearMarkers() {
    this.markerOverlay?.replaceChildren();
    this.markerStroke = null;
    this.markerCamera = null;
    this.canvas.style.cursor = "";
  }
  installControls() {
    const c = this.canvas;
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener("auxclick", (e) => { if (e.button === 1) e.preventDefault(); });
    c.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      c.focus();
      c.setPointerCapture(e.pointerId);
      if (e.button === 1 && e.pointerType !== "touch") {
        if (this.markerStroke || this.pointers.size) return;
        if (this.markerOverlay?.childElementCount >= 1000) this.clearMarkers();
        this.markerCamera = JSON.stringify(this.camera);
        const point = this.markerPoint(e);
        const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
        for (const [key, value] of Object.entries({fill:"none",stroke:"#ff3030","stroke-width":"4","stroke-linecap":"round","stroke-linejoin":"round",points:`${point} ${point}`})) line.setAttribute(key, value);
        this.markerOverlay.append(line);
        this.markerStroke = { pointerId: e.pointerId, line, count: 2 };
        c.style.cursor = "crosshair";
        return;
      }
      this.pointers.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        button: e.button,
      });
    });
    c.addEventListener("pointermove", (e) => {
      if (this.markerStroke?.pointerId === e.pointerId) {
        e.preventDefault();
        const line = this.markerStroke.line;
        for (const sample of e.getCoalescedEvents?.().length ? e.getCoalescedEvents() : [e]) {
          if (this.markerStroke.count++ >= 10000) break;
          line.setAttribute("points", `${line.getAttribute("points")} ${this.markerPoint(sample)}`);
        }
        return;
      }
      const old = this.pointers.get(e.pointerId);
      if (!old) return;
      const previous = [...this.pointers.values()].map((p) => ({ ...p }));
      this.pointers.set(e.pointerId, { ...old, x: e.clientX, y: e.clientY });
      const next = [...this.pointers.values()];
      if (next.length === 2) {
        const distance = (ps) =>
            Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y),
          center = (ps) => [(ps[0].x + ps[1].x) / 2, (ps[0].y + ps[1].y) / 2],
          a = center(previous),
          b = center(next);
        this.pan(b[0] - a[0], b[1] - a[1]);
        this.zoom(
          Math.max(1, distance(previous)) / Math.max(1, distance(next)),
        );
      } else if (old.button !== 0 || e.shiftKey)
        this.pan(e.clientX - old.x, e.clientY - old.y);
      else {
        this.camera.yaw -= (e.clientX - old.x) * 0.006;
        this.camera.pitch = Math.max(
          0.001,
          Math.min(
            Math.PI - 0.001,
            this.camera.pitch - (e.clientY - old.y) * 0.006,
          ),
        );
      }
      this.request();
    });
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
      c.addEventListener(event, (e) => {
        this.pointers.delete(e.pointerId);
        if (this.markerStroke?.pointerId === e.pointerId) {
          this.markerStroke = null;
          c.style.cursor = "";
        }
      });
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const delta =
          e.deltaY *
          (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1);
        this.zoom(Math.exp(Math.max(-1, Math.min(1, delta * 0.0015))));
        this.request();
      },
      { passive: false },
    );
    c.addEventListener("dblclick", (e) => { if (e.button === 0) this.fit(); });
    c.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.clearMarkers();
      }
      if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        this.fit();
      }
    });
  }
  async capture() {
    this.render();
    await this.device.queue.onSubmittedWorkDone();
    return this.canvas.toDataURL("image/png");
  }
}
