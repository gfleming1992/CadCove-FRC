#!/usr/bin/env bun
import path from 'node:path';
import {access, stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {initializeToolbox,updateToolboxGuidance} from '../lib/toolbox-project.js';
import {readRobotProject, auditRobotProject} from '../lib/robot-project.js';
import {bundledRuntime, externalBun, runtimeVersion, nativeExecutable} from '../lib/runtime-location.js';
import {cadFeedback} from '../lib/cad-feedback.js';
import {javaExecutable} from '../lib/java-runtime.js';
import {runSimulation,sessionRequest,recoverSimulation} from '../lib/simulation-session.js';
import {exportBridge} from '../lib/bridge-export.js';
import {viewerRequest} from '../lib/viewer-client.js';
import {importSeasonKnowledge,searchSeasonKnowledge} from '../lib/season-knowledge.js';
import {createExample} from '../lib/example-create.js';
import {validateSimulation} from '../lib/simulation-validation.js';
import {createPhysicsMode} from '../lib/physics-modes.js';

import {buildCustomSimulator} from '../lib/custom-simulator.js';

const optionsByCommand = {
  'sim-build': ['project'],
  'cad-sketch': ['action','input','output','python'],
  'cad-analysis': ['action','input','output','python','workspace','entry','freecad','gmsh','ccx'],
  'cad-references': ['workspace','entry','python','input'],
  'cad-mates': ['action','input','output','python','solver','workspace','target'],
  'cad-build': ['workspace','entry','python'],
  'cad-session': ['workspace','entry','python'],
  'cad-inspect': ['workspace','entry','python','script'],
  'cad-discover': ['workspace','entry','python','ids','output','decisions'],
  'cad-export': ['workspace','entry','python','output'],
  'cad-capture': ['workspace','entry','view','ids','output'],
  'cad-open': ['workspace'],
  'cad-motion-play': ['workspace','entry','input'],
  'cad-motion-pause': ['workspace','entry'],
  'cad-motion-resume': ['workspace','entry'],
  'cad-motion-seek': ['workspace','entry','seconds'],
  'cad-mechanisms': ['workspace','entry'],
  'cad-move': ['workspace','entry','part','degrees'],
  'cad-rotate': ['workspace','entry','part','degrees'],
  'cad-animate': ['workspace','entry','part','rpm','seconds'],
  'cad-motion-stop': ['workspace','entry'],
  'cad-motion-reset': ['workspace','entry'],
  'cad-motion-state': ['workspace','entry'],
  'cad-visibility': ['workspace','entry','options'],
  'cad-reveal': ['workspace','entry','options'],
  'cad-reveal-stop': ['workspace','entry'],
  'cad-reveal-state': ['workspace','entry'],
  'cad-view': ['workspace','entry','options'],
  'cad-view-state': ['workspace','entry'],
  'cad-highlight': ['workspace','entry','input'],
  'cad-clear-highlights': ['workspace','entry'],
  'cad-highlight-state': ['workspace','entry'],
  'cad-selection': ['workspace','entry'],
  'mechanism-export': ['workspace','entry','output'],
  'canvas': ['workspace','target','entry','action','input'],
  'mechanism-preview-open': ['workspace','field'],
  'mechanism-preview': ['workspace','action','input'],
  mcp: ['workspace'],
  init: ['workspace', 'name', 'id', 'cad-dir', 'build-dir', 'dry-run'],
  'guidance-update': ['workspace','dry-run'],
  'sim-mode': ['project','mode','output','recipe'],
  'example-create': ['workspace','example','phoenix-descriptor'],
  'season-import': ['workspace','pack','pdf','pages','revision','kind'],
  'season-search': ['directory','query','offset','limit'],
  doctor: ['project'], audit: ['project'], 'sim-validate': ['project'], capabilities: [], help: [],
  'cad-status': ['workspace','entry'], 'cad-preview': ['workspace','entry'],
  'sim-run': ['project'], 'sim-state': ['project'], 'sim-objects': ['project','query-file'], 'sim-controls': ['project','input'], 'sim-stop': ['project'],
  'sim-recover': ['project'], 'bridge-export': ['workspace','review'],
  'sim-scene': ['project'],
  'sim-capture': ['project','options'], 'sim-view': ['project','options'], 'sim-viewer-state': ['project'],
  'sim-practice': ['project','options'],
  'sim-match': ['project','input'], 'sim-autonomous': ['project','input'], 'sim-devices': ['project'], 'sim-motor-controls': ['project'],
};
function parse(args) {
  const command = args.shift() ?? 'help';
  if (!Object.hasOwn(optionsByCommand, command)) throw Error(`Unknown command: ${command}`);
  const options = {};
  while (args.length) {
    const arg = args.shift();
    const key = arg.startsWith('--') ? arg.slice(2) : '';
    if (!optionsByCommand[command].includes(key) || Object.hasOwn(options, key)) throw Error(`Unknown or duplicate option: ${arg}`);
    if (key === 'dry-run'||key==='review') options[key] = true;
    else {
      const value = args.shift();
      if (!value || value.startsWith('--')) throw Error(`Missing value for --${key}`);
      options[key] = value;
    }
  }
  return {command, options};
}
async function regularFile(file, executable = false) {
  try { await access(file, executable ? constants.X_OK : constants.R_OK); return (await stat(file)).isFile(); }
  catch { return false; }
}

async function run() {
  const {command, options} = parse(process.argv.slice(2));
  if(['cad-sketch','cad-analysis'].includes(command)){const {designCommand}=await import('../lib/design-command.js');return designCommand(command,options);}
  if(command==='cad-references'){const {cadCommand}=await import('../lib/cad-command.js');return cadCommand(command,options);}
  if(command==='cad-mates'){const {mateCommand}=await import('../lib/mate-command.js');return mateCommand(options);}
  if(['cad-build','cad-session','cad-inspect','cad-export','cad-discover'].includes(command)){const {cadCommand}=await import('../lib/cad-command.js');return cadCommand(command,options);}
  if(['cad-motion-play','cad-motion-pause','cad-motion-resume','cad-motion-seek','cad-mechanisms','cad-move','cad-selection','cad-rotate','cad-animate','cad-motion-stop','cad-motion-reset','cad-motion-state'].includes(command)){const {cadMotion}=await import('../lib/cad-motion.js');return cadMotion(command,options);}
  if(['cad-highlight','cad-clear-highlights','cad-highlight-state'].includes(command)){const {cadHighlights}=await import('../lib/cad-highlights.js');return cadHighlights(command,options);}
  if(['cad-visibility','cad-view','cad-view-state','cad-reveal','cad-reveal-stop','cad-reveal-state'].includes(command)){const {cadView}=await import('../lib/cad-view.js');return cadView(command,options);}
  if(command==='canvas'){
    const {connectEditor}=await import('../lib/mcp-proxy.js');const workspace=path.resolve(options.workspace??process.cwd());
    const client=await connectEditor(workspace);try{const result=await client.callTool({name:'canvas_command',arguments:{workspace,target:options.target,entry:options.entry,action:options.action??'capabilities',options:options.input?await Bun.file(options.input).json():{}}},undefined,{timeout:150000});const message=result.content.find(c=>c.type==='text')?.text;if(result.isError)throw Error(message??'Canvas command failed');return JSON.parse(message);}finally{await client.close();}
  }
  if(command==='mechanism-preview-open'||command==='mechanism-preview'){
    const {connectEditor}=await import('../lib/mcp-proxy.js');const workspace=path.resolve(options.workspace??process.cwd());
    if(options.field!==undefined&&!['true','false'].includes(options.field))throw Error('--field must be true or false');
    const args=command==='mechanism-preview-open'?{workspace,field:options.field==='true'}:{workspace,action:options.action,options:options.input?await Bun.file(options.input).json():{}};
    const client=await connectEditor(workspace);try{const result=await client.callTool({name:command==='mechanism-preview-open'?'open_mechanism_preview':'mechanism_preview',arguments:args},undefined,{timeout:150000});const text=result.content.find(c=>c.type==='text')?.text;if(result.isError)throw Error(text??'Preview failed');return JSON.parse(text);}finally{await client.close();}
  }
  if(command==='mechanism-export'){const {exportMechanism}=await import('../lib/mechanism-export.js');return exportMechanism(options);}
  if(command==='cad-capture'){const {captureCad}=await import('../lib/cad-capture.js');return captureCad(options);}
  if(command==='cad-open'){const {openRobotCad}=await import('../lib/mcp-proxy.js');const result=await openRobotCad(options.workspace??process.cwd());if(result.ok===false)process.exitCode=1;return result;}
  if (command === 'mcp') {const {runMcpProxy}=await import('../lib/mcp-proxy.js');await runMcpProxy(options.workspace??process.cwd());return;}
  if (command === 'help') return {schema: 1, ok: true, commands: {
    'cad-visibility': 'cadcove cad-visibility --workspace PATH --options visibility.json (action hide/show/isolate/show-all/state, ids?, names?; defaults to user selection)',
    'cad-reveal': 'cadcove cad-reveal --workspace PATH [--options reveal.json] (ids?, cycles 1–10, intervalMs 500–5000; defaults to highlighted parts, 2 cycles)',
    'cad-reveal-stop': 'cadcove cad-reveal-stop --workspace PATH',
    'cad-reveal-state': 'cadcove cad-reveal-state --workspace PATH',
    'cad-view': 'cadcove cad-view --workspace PATH --options view.json (named view, fit, ids, pan, zoom, camera)',
    'cad-view-state': 'cadcove cad-view-state --workspace PATH',
    'cad-highlight': 'cadcove cad-highlight --workspace PATH --input highlights.json ({parts:[{id,color?}]})',
    'cad-clear-highlights': 'cadcove cad-clear-highlights --workspace PATH',
    'cad-highlight-state': 'cadcove cad-highlight-state --workspace PATH',
    'cad-rotate': 'cadcove cad-rotate --workspace PATH [--entry models.py] --part ID --degrees ANGLE (absolute joint angle; temporary pose)',
    'cad-animate': 'cadcove cad-animate --workspace PATH [--entry models.py] --part ID --rpm RPM [--seconds 10] (temporary motion, max 300 seconds)',
    'cad-motion-stop': 'cadcove cad-motion-stop --workspace PATH [--entry models.py]',
    'cad-motion-reset': 'cadcove cad-motion-reset --workspace PATH [--entry models.py]',
    'cad-motion-play': 'cadcove cad-motion-play --workspace PATH --input trajectory.json',
    'cad-motion-pause': 'cadcove cad-motion-pause --workspace PATH',
    'cad-motion-resume': 'cadcove cad-motion-resume --workspace PATH',
    'cad-motion-seek': 'cadcove cad-motion-seek --workspace PATH --seconds SECONDS',
    'cad-mechanisms': 'cadcove cad-mechanisms --workspace PATH',
    'cad-move': 'cadcove cad-move --workspace PATH --part ID --degrees DELTA',
    'cad-selection': 'cadcove cad-selection --workspace PATH [--entry models.py]',
    'cad-motion-state': 'cadcove cad-motion-state --workspace PATH [--entry models.py]',
    'canvas': 'cadcove canvas --workspace PATH [--target active|cad|field] --action capabilities|state|selection|highlight|opacity|visibility|reveal|view|motion|capture|place|physics|motors|zero|cad [--input JSON_FILE] (lengths mm, angles deg, time seconds)',
    'mechanism-preview-open': 'cadcove mechanism-preview-open --workspace PATH [--field true] (cached native CAD and optional field context; no WPILib)',
    'mechanism-preview': 'cadcove mechanism-preview --workspace PATH --action state|view|capture|selection|visibility|place|motion|physics|motors|zero|cad [--input JSON_FILE]',
    'mechanism-export': 'cadcove mechanism-export --workspace PATH [--entry models.py] --output NEW_DIRECTORY (validated world and occurrence bindings)',
    'cad-build': 'cadcove cad-build --workspace PATH [--entry models.py] [--python PYTHON]',
    'cad-session': 'cadcove cad-session --workspace PATH [--entry models.py] [--python PYTHON] (warm JSONL build/inspect/export; stdin EOF stops worker)',
    'cad-mates': 'cadcove cad-mates --action capabilities|solve|solve-mechanism|animate|inspect-step [--input REQUEST.json --output NEW_RESULT.json] [--solver EXECUTABLE] (animate: --workspace PATH --target cad|field; uses current cached geometry and pose)',
    'cad-sketch': 'cadcove cad-sketch --action capabilities|solve [--input REQUEST.json --output NEW_RESULT.json --python PYTHON] (optional PlaneGCS)',
    'cad-analysis': 'cadcove cad-analysis --action capabilities|prepare|solve --input REQUEST.json --output NEW_RESULT (solve: new directory; --workspace, --freecad, --gmsh, --ccx; optional external FEA)',
    'cad-references': 'cadcove cad-references --workspace PATH --input REFERENCES.json (current exact geometry; named cylinder references)',
    'cad-discover': 'cadcove cad-discover --workspace PATH --output NEW_REPORT.json [--ids ID,ID] [--decisions DECISIONS.json] (experimental coaxial candidates; no automatic mates)',
    'cad-inspect': 'cadcove cad-inspect --workspace PATH --script CHECKS.py (build then exact BREP inspection; assign result)',
    'cad-export': 'cadcove cad-export --workspace PATH --output model.step',
    'cad-capture': 'cadcove cad-capture --workspace PATH [--entry models.py] [--view iso|front|right|top] [--ids ID,ID] --output frame.png (open VS Code canvas required)',
    'cad-open': 'cadcove cad-open --workspace PATH (open robot in the running VS Code canvas; no agent MCP registration required)',
    mcp: 'cadcove mcp --workspace PATH (stdio bridge to the automatic VS Code MCP server)',
    init: 'cadcove init --workspace PATH [--name NAME] [--id ID] [--cad-dir cad] [--build-dir build/cadcove] [--dry-run]',
    'guidance-update': 'cadcove guidance-update --workspace PATH [--dry-run] (preserves edited guidance and writes reviewable proposals)',
    'sim-mode': 'cadcove sim-mode --project DETAILED_PROJECT --mode accurate|gameplay --output NEW_DIRECTORY [--recipe JSON_FILE] (separate build; gameplay requires a source-hash-pinned recipe)',
    'example-create': 'cadcove example-create --workspace NEW_DIRECTORY [--example team3310-rebuilt|training-robot] (default: ready-to-play team robot; requires Team Robot edition and WPILib JDK)',
    'season-import': 'cadcove season-import --workspace PATH --pack SEASON_JSON --pdf LOCAL_PDF --revision LABEL [--kind manual|updates] [--pages EXTRACTED_PAGES_JSON]',
    'season-search': 'cadcove season-search --directory IMPORTED_DIRECTORY --query TEXT [--offset 0] [--limit 8] (limit 1–20; follow nextOffset for more matches)',
    'sim-build': 'cadcove sim-build --project PATH (build the explicitly selected project Rust simulator)',
    doctor: 'cadcove doctor --project PATH/robot.sim.json',
    audit: 'cadcove audit --project PATH/robot.sim.json',
    'sim-validate': 'cadcove sim-validate --project PATH (temporary native world load at tick zero; no robot program or live session)',
    capabilities: 'cadcove capabilities',
    'cad-status': 'cadcove cad-status --workspace PATH',
    'cad-preview': 'cadcove cad-preview --workspace PATH',
    'sim-run': 'cadcove sim-run --project PATH (foreground; ready/stopped JSON events, robot logs on stderr)',
    'sim-state': 'cadcove sim-state --project PATH',
    'sim-objects': 'cadcove sim-objects --project PATH [--query-file JSON_FILE]',
    'sim-controls': 'cadcove sim-controls --project PATH --input JSON_FILE (one input packet; enable lease expires after one second)',
    'sim-stop': 'cadcove sim-stop --project PATH',
    'sim-recover': 'cadcove sim-recover --project PATH (remove a stale launcher lock only when its processes have exited)',
    'bridge-export': 'cadcove bridge-export --workspace PATH [--review] (review exports a separate versioned copy and reports differences; no automatic merge)',
    'sim-scene': 'cadcove sim-scene --project PATH (validated local scene descriptor)',
    'sim-capture': 'cadcove sim-capture --project PATH [--options JSON_FILE] (capture the open editor view; returns PNG path and physics tick)',
    'sim-view': 'cadcove sim-view --project PATH --options JSON_FILE (camera/view/fit/follow)',
    'sim-viewer-state': 'cadcove sim-viewer-state --project PATH',
    'sim-practice': 'cadcove sim-practice --project PATH --options JSON_FILE ({action:start|stop,input:keyboard|gamepad}; view must be focused to start)',
    'sim-match': 'cadcove sim-match --project PATH [--input JSON_FILE] (query season or start/abort with season-specific options)',
    'sim-autonomous': 'cadcove sim-autonomous --project PATH [--input JSON_FILE] (query/select the robot autonomous chooser)',
    'sim-devices': 'cadcove sim-devices --project PATH',
    'sim-motor-controls': 'cadcove sim-motor-controls --project PATH (read-only host-side control requests)',
  }, output: 'JSON on stdout; exit 0 success, 1 failed checks, 2 invalid command/configuration'};
  if (command === 'capabilities') return {schema: 1, ok: true, version: runtimeVersion, commands: Object.keys(optionsByCommand),
    distribution: bundledRuntime ? (externalBun?'external-bun-runtime':'standalone-runtime') : 'source-checkout', bundledRuntimeInstaller: false,
    agent: {providerRequired: false, interface: 'cli-and-filesystem', instructions: '.cadcove/AGENT.md'},
    adapters: [{id: 'wpilib-java-phoenix6', status: 'integration-required', devices: ['TalonFX', 'CANcoder', 'Pigeon2']},
      {id: 'limelight-networktables', status: 'simulation-subset', features: ['AprilTag pose observations', 'configured optics and latency']}],
    unsupported: ['complete automatic CAD mechanism inference', 'arbitrary CTRE devices', 'C++ robot adapter', 'official future-season rules'],
  };
  if (command === 'init') return initializeToolbox({workspace: options.workspace, name: options.name, id: options.id, cadDirectory: options['cad-dir'], buildDirectory: options['build-dir'], dryRun: !!options['dry-run']});
  if(command==='guidance-update'){const result=await updateToolboxGuidance({workspace:options.workspace,dryRun:!!options['dry-run']});process.exitCode=result.ok?0:1;return result;}
  if(command==='sim-mode')return createPhysicsMode({project:options.project,mode:options.mode,output:options.output,recipeFile:options.recipe});
  if(command==='example-create')return createExample({workspace:options.workspace,example:options.example,phoenixDescriptor:options['phoenix-descriptor']});
  if(command==='season-import')return importSeasonKnowledge({workspace:options.workspace,packFile:options.pack,pdf:options.pdf,pagesFile:options.pages,revision:options.revision,kind:options.kind});
  if(command==='season-search')return searchSeasonKnowledge({directory:options.directory,query:options.query,offset:options.offset,limit:options.limit});
  if(command==='bridge-export')return exportBridge(options.workspace,{review:!!options.review});
  if (command === 'cad-status' || command === 'cad-preview') {
    const result=await cadFeedback(options.workspace,{preview:command==='cad-preview',entry:options.entry});process.exitCode=result.ok?0:1;return result;
  }
  if (!options.project) throw Error('--project is required; the toolbox never selects another team’s example implicitly');
  const project = await readRobotProject(options.project);
  if(command==='sim-build'){
    const controller=new AbortController(),stop=()=>controller.abort();
    process.on('SIGINT',stop);process.on('SIGTERM',stop);
    try{return await buildCustomSimulator(project,{signal:controller.signal});}
    finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
  }
  if(command==='sim-validate'){const result=await validateSimulation(project);process.exitCode=result.ok?0:1;return result;}
  if(['sim-capture','sim-view','sim-viewer-state','sim-practice'].includes(command)){
    if(['sim-view','sim-practice'].includes(command)&&!options.options)throw Error('--options JSON_FILE is required');
    return viewerRequest(project,{'sim-capture':'capture','sim-view':'view','sim-viewer-state':'state','sim-practice':'practice'}[command],options.options?await Bun.file(options.options).json():{});
  }
  if(command==='sim-scene'){
    const audit=await auditRobotProject(project);if(!audit.canLoad)throw Error(audit.errors.join('; '));
    return {schema:1,ok:true,command,project:project.profilePath,build:project.build,assets:project.cad,bindings:path.join(project.build,'scene-bindings.json'),worldHash:audit.worldHash,
      profile:{id:project.profile.id,name:project.profile.name,physicsMode:project.profile.physicsMode??{name:'accurate'},practiceControls:project.profile.practiceControls??[],practiceInput:project.profile.practiceInput??null}};
  }
  if(command==='sim-recover')return recoverSimulation(project);
  if(command==='sim-run'){
    const controller=new AbortController(),stop=()=>controller.abort();
    process.on('SIGINT',stop);process.on('SIGTERM',stop);
    try{const result=await runSimulation(project,{signal:controller.signal,onReady:r=>console.log(JSON.stringify(r))});process.exitCode=result.ok?0:1;return result;}
    finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
  }
  if(command.startsWith('sim-')){
    if(command==='sim-controls'&&!options.input)throw Error('--input JSON_FILE is required');
    const route={'sim-state':'state','sim-objects':'objects','sim-controls':'controls','sim-stop':'shutdown','sim-match':'match','sim-autonomous':'autonomous','sim-devices':'devices','sim-motor-controls':'motor-controls'}[command];
    const body=command==='sim-stop'?{}:options.input?await Bun.file(options.input).json():undefined;
    const query=options['query-file']?await Bun.file(options['query-file']).json():undefined;
    const result=await sessionRequest(project,route,{body,query});return {schema:1,ok:true,command,result};
  }
  const audit = await auditRobotProject(project);
  if (command === 'audit') { process.exitCode = audit.canLoad ? 0 : 1; return {schema: 1, command, ok: audit.canLoad, ...audit}; }
  const binary = nativeExecutable(project);
  let java,javaError;try{java=await javaExecutable(project);}catch(error){javaError=error.message;}
  const checks = await Promise.all([
    ['native-engine', binary, true, project.profile.runtime.customSimulator ? 'Run CadCove: Build Custom Simulator or cadcove sim-build --project '+project.profilePath : 'Install/build the native simulator for this platform; set INSTANTCAD_SIM_BINARY if needed.'],
    ['jdk', java??'', true, javaError||'Select the WPILib JDK with INSTANTCAD_JDK or runtime.jdk.'],
    ['robot-program', project.runtime.jar, false, 'Build this team’s simulation JAR and set runtime.jar to its actual output.'],
  ].map(async ([id, file, executable, remedy]) => ({id, path: file, ok: await regularFile(file, executable), remedy})));
  let libraries = false;
  try { libraries = (await stat(project.runtime.nativeLibraries)).isDirectory(); } catch {}
  checks.push({id: 'vendor-library-directory', path: project.runtime.nativeLibraries, ok: libraries, remedy: 'Build/extract the WPILib and vendor desktop simulation libraries for this platform.'});
  checks.push({id: 'compiled-project', ok: audit.canLoad, errors: audit.errors, remedy: 'Compile CAD bindings/world and resolve every audit error.'});
  // A doctor is read-only: do not execute user-selected binaries merely to
  // inspect a project. Presence is not ABI/device or hardware qualification.
  const ok = checks.every(c => c.ok);
  process.exitCode = ok ? 0 : 1;
  return {schema: 1, command, ok, project: project.profilePath, platform: `${process.platform}-${process.arch}`, checks, reviewRequired: audit.reviewRequired, qualification: 'not-certified', scope: 'File prerequisites and artifact consistency; executables, vendor ABI and physical fidelity are not qualified by this check'};
}

// Long-running launch consumers parse newline-delimited events. Keep its final
// result/error on one line too; short commands retain human-readable JSON.
const jsonIndent=process.argv[2]==='sim-run'?undefined:2;
try { const result=await run();if(result!==undefined)console.log(JSON.stringify(result, null, jsonIndent)); }
catch (error) { (process.argv[2]==='mcp'?console.error:console.log)(JSON.stringify({schema: 1, ok: false, error: {code: 'INVALID_REQUEST_OR_PROJECT', message: error.message}}, null, jsonIndent)); process.exitCode = 2; }
