import {captureScene} from './core/scene-capture.js';
import {Viewer} from './core/viewer.js';
import {snapshot,hash} from './core/revision.js';
import {decodeScene,encodeScene} from './core/mesh.js';
import {createVSCodeHost} from './hosts/vscode.js';
const config=globalThis.INSTANTCAD_HOST,host=createVSCodeHost(config),identity=config.runtime;
// Embedding products can keep the canvas free of authoring controls. This
// changes presentation only; disk-driven builds and feedback stay identical.
if(config.minimalUI){document.querySelector('header').style.display='none';}
const canvas=document.querySelector('#canvas'),status=document.querySelector('#status'),button=document.querySelector('#build'),stop=document.querySelector('#stop');
const viewer=new Viewer(canvas);
let head,workerRevision,building=false,dirty=false,disposed=false,initialized=false,feedbackDirty=false,timer;
const message=(text,error=false)=>{status.textContent=text;status.dataset.error=String(error);};
const report=(phase,extra={})=>host.report({phase,revision:head??null,workerLoaded:host.nativeLoaded,parts:viewer.scene?.parts.length??0,gpuBytes:viewer.gpuBytes??0,camera:viewer.camera,upload:viewer.lastUpload,...extra}).catch(()=>{});
const source=async()=>snapshot(await host.readSources(),config.entry,identity);
async function execute(revision, current) {
  current??=await source();
  if(current.revision!==revision)throw Error('Source changed before build');
  return host.nativeBuild(revision);
}
async function save(scene) {
  const binary=encodeScene(scene),meshHash=await hash(binary);
  await host.writeArtifact('scene.bin',binary);
  await host.writeArtifact('scene.json',JSON.stringify({revision:head,meshHash,runtime:identity}));
  await saveFeedback(scene);
}
async function saveFeedback(scene) {
  viewer.render();await viewer.device.queue.onSubmittedWorkDone();
  const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  let preview=null;
  if(png){const bytes=await png.arrayBuffer();await host.writeArtifact('preview.png',bytes);preview={revision:head,sha256:await hash(bytes)};}
  // Commit feedback last so an agent cannot pair a new revision with an old
  // preview during a rebuild. The digest also detects interrupted replacements.
  await host.writeArtifact('status.json',JSON.stringify({ok:true,revision:head,runtime:identity,parts:scene.parts.map(({id,name,color,metrics})=>({id,name,color,metrics})),timings:scene.timings,preview},null,2));
}
async function build() {
  if(building){dirty=true;return;}
  building=true;button.disabled=true;stop.hidden=false;dirty=false;
  const started=performance.now();
  try{
    const current=await source();
    if(current.revision===head&&feedbackDirty&&viewer.scene){
      // The user restored the last accepted source after a failed edit. Reuse
      // its geometry but commit fresh feedback instead of leaving the old error.
      await saveFeedback(viewer.scene);
      if((await source()).revision!==head){dirty=true;throw Error('Source changed while restoring feedback; rebuilding the latest files.');}
      feedbackDirty=false;message(`${viewer.scene.parts.length} parts rendering locally`);
      await report('ready',{source:'restored'});return;
    }
    message('Building local CAD in the editor…');await report('building');
    const scene=await execute(current.revision,current);workerRevision=current.revision;
    if((await source()).revision!==current.revision){dirty=true;throw Error('Source changed during build; rebuilding the latest files.');}
    const uploadStart=performance.now();
    const first=!head;viewer.setScene(scene,first);viewer.render();
    await viewer.device.queue.onSubmittedWorkDone();
    head=current.revision;
    scene.timings.client={gpuUploadAndWaitMs:performance.now()-uploadStart,firstUpdatedFrameMs:performance.now()-started,...viewer.lastUpload};
    host.saveState({entry:config.entry,camera:viewer.camera});
    message(`${scene.parts.length} parts rendering locally · ${((performance.now()-started)/1000).toFixed(2)} s build`);
    await save(scene);feedbackDirty=false;await report('ready',{source:'build',buildMs:performance.now()-started});
  }catch(error){
    feedbackDirty=true;message(error.message,true);await report('error',{error:error.message});
    await host.writeArtifact('status.json',JSON.stringify({ok:false,error:error.message,revision:head??null,runtime:identity})).catch(()=>{});
  }finally{
    building=false;button.disabled=false;stop.hidden=true;
    if(dirty&&!disposed){dirty=false;void build();}
  }
}
async function refresh() {
  if(disposed||!initialized)return;
  if(building){dirty=true;return;}
  try{if((await source()).revision!==head||feedbackDirty)await build();else{message(`${viewer.scene.parts.length} parts rendering locally`);await report('ready',{source:'unchanged'});}}catch(error){message(error.message,true);await report('error',{error:error.message});}
}
button.textContent='Rebuild';button.onclick=()=>build();
stop.onclick=()=>{dirty=false;void host.nativeCancel();workerRevision=undefined;};
document.querySelector('#fit').onclick=()=>viewer.fit();
const open=document.querySelector('#connect');open.textContent='Open source';open.onclick=()=>host.reveal();
document.querySelector('#name').textContent=`${config.project} / ${config.entry}`;
const inspect=document.createElement('button');inspect.textContent='Inspect';document.querySelector('nav').append(inspect);
inspect.onclick=()=>{
  const dialog=document.createElement('dialog'),form=document.createElement('form'),input=document.createElement('textarea'),run=document.createElement('button'),close=document.createElement('button');
  input.setAttribute('aria-label','CAD inspection Python');input.rows=8;input.style.width='100%';input.value='result = [{"id": p.get("id"), "valid": p["shape"].isValid(), "volume": p["shape"].Volume()} for p in parts]';
  run.textContent='Run inspection';close.textContent='Close';close.type='button';close.onclick=()=>dialog.close();form.append(input,run,close);dialog.append(form);document.body.append(dialog);dialog.onclose=()=>dialog.remove();dialog.showModal();
  form.onsubmit=async(event)=>{
    event.preventDefault();if(building)return;
    try{if(workerRevision!==head){await execute(head);workerRevision=head;}message(JSON.stringify(await host.nativeInspect(input.value)));dialog.close();}
    catch(error){message(error.message,true);}
  };
};
host.onAgentRequest(async(method,args)=>{
 if(method!=='capture')throw Error('Unknown source viewer request');
 if(building||!initialized||!head)throw Error('CAD is still building');
 if((await source()).revision!==head)await refresh();
 if(building||feedbackDirty||(await source()).revision!==head)throw Error('CAD source has not built successfully');
 const revision=head,frame=await captureScene(viewer,args);
 if(head!==revision||(await source()).revision!==revision)throw Error('Scene changed during capture');
 return {...frame,revision};
});
window.addEventListener('cad-configuration-changed',()=>message('CAD folder settings changed. Close and reopen this model to use the new folders.'));
host.watch(()=>{clearTimeout(timer);timer=setTimeout(()=>refresh(),100);});
window.addEventListener('beforeunload',()=>{disposed=true;clearTimeout(timer);void host.nativeCancel();host.dispose();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){viewer.request();void refresh();}});
(async()=>{
  try{
    await viewer.init();
    const current=await source();
    const cached=await host.cache();
    const cachedScene=cached && await hash(cached.bytes)===cached.meshHash ? decodeScene(cached.bytes) : null;
    if(cachedScene&&cached.revision===current.revision){
      viewer.setScene(cachedScene,true);head=cached.revision;
      const state=host.state();if(state?.entry===config.entry&&state.camera)viewer.camera=state.camera;
      viewer.render();await viewer.device.queue.onSubmittedWorkDone();
      if(!cached.feedbackSucceeded)await saveFeedback(viewer.scene);
      message(`${viewer.scene.parts.length} parts restored from .instantcad · no CAD engine needed`);
      await report('ready',{source:'disk-cache'});
    }else await build();
    initialized=true;
  }catch(error){message(error.message,true);await report('error',{error:error.message});}
})();
