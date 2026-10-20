import path from 'node:path';
import {lstat, mkdir, readFile, writeFile, realpath} from 'node:fs/promises';
import {agentGuidanceFiles} from './agent-guidance.js';
import {cadReferenceFiles} from './cad-reference.js';
import {guidanceState,guidanceStateFile,updateManagedGuidance,agentEntrypoints,agentEntrypointChanges} from './guidance-update.js';

const calibrationSubjects = [
  'CAD geometry and occurrence bindings', 'Motor ratios and frame directions',
  'Mass, inertia and center of gravity', 'Tire, fuel and mechanism contact behavior',
  'Complete mechanism articulation and sensors', 'Full-match hardware comparison',
];

function relativeDirectory(value, label) {
  if (typeof value !== 'string' || !value || value.includes('\\') || /[\x00-\x1f:]/.test(value) || path.posix.isAbsolute(value) || value.split('/').some(p => !p || p === '.' || p === '..')) {
    throw Error(`${label} must be a portable workspace-relative directory without dot segments`);
  }
  return value;
}

// Refuse symlinked output paths: initialization must not edit a different
// workspace through an existing .github/, cad/, or AGENTS.md link.
async function checkPath(root, relative) {
  const pieces = relative.split('/');
  let current = root;
  for (const [i, piece] of pieces.entries()) {
    current = path.join(current, piece);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || (i < pieces.length - 1 && !stat.isDirectory())) throw Error(`Unsafe initialization path: ${relative}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

async function existing(file) {
  try { return await readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function initializeToolbox({workspace, name = 'My robot', id = 'my-robot', cadDirectory = 'cad', buildDirectory = 'build/cadcove', dryRun = false, guidanceOnly = false}) {
  if (!workspace) throw Error('An explicit workspace directory is required');
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw Error('Project id must be 1–64 lowercase letters, digits or hyphens');
  if (typeof name !== 'string' || !name.trim() || name.length > 120 || /[\x00-\x1f]/.test(name)) throw Error('Invalid project name');
  const cad = relativeDirectory(cadDirectory, 'CAD directory');
  const build = relativeDirectory(buildDirectory, 'Build directory');
  const overlaps = (a,b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
  if (overlaps(cad, build) || [cad, build].some(p => ['.git', '.github', '.cadcove', '.vscode'].some(r => overlaps(p, r)))) throw Error('CAD, build, and toolbox metadata directories must be separate');
  // A user-selected workspace may itself be a symlink; resolve that selection
  // once, then prohibit links below it for every generated file.
  let root = path.resolve(workspace);
  try { root = await realpath(root); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const profile = {
    schema: 1, id, name, cad: {robot: `${build}/robot`, field: `${build}/field`}, build,
    runtime: {adapter: 'wpilib-java-phoenix6', clock: 'physics', project: '.', jar: 'build/libs/robot.jar', nativeLibraries: 'build/jni/release'},
    calibration: calibrationSubjects.map(subject => ({subject, status: 'unknown', evidence: 'Not integrated yet; record robot-specific evidence before qualification.'})),
    practiceControls: [],
  };
  const instructions = `# CadCove workspace integration

Use the student's existing editor agent with ordinary filesystem edits and the
CadCove CLI. No AI API key or agent tool registration is needed. To open the robot,
call MCP \`open_robot_cad\` when available, otherwise run
\`cadcove cad-open --workspace .\`. The editor server starts automatically;
missing chat tools do not mean the server is stopped. You can also open models
through VS Code: right-click a Python/STEP file → **CadCove: Open in CAD Canvas**.
All interactive viewing lives in that WebGPU webview. Use command-line
build/inspect/export/capture feedback for modeling; do not drive CAD through
mouse clicks or an in-canvas chat. The local editor bridge is an implementation
detail for captures, not a required agent MCP setup.

Read \`.cadcove/skills/frc-workflow/SKILL.md\` to select focused CAD, CTRE,
vision, season-rules and validation skills. Read only the relevant skills.
For a ready-to-play example, use \`cadcove example-create --workspace NEW_DIRECTORY\`
(default: Team 3310 Amarillo/REBUILT, requires the Team Robot edition and WPILib JDK).
In VS Code use **CadCove: Play Team Robot Example**. Keep the small training robot
for contract tests, not as the primary robot design example.
\`.cadcove/frc.json\` selects local season knowledge and example context;
it never changes the runtime robot/field or silently selects another season.

## Source and generated data

- CAD source: \`${cad}/\`. New models use native Python/CadQuery and OCCT.
  Read \`.cadcove/skills/references/native-cadquery.md\`. Preserve IDs, colors,
  local source modules and vendor STEP files. Existing configured JS projects
  remain compatible until explicitly migrated.
- Robot source: this WPILib workspace. Keep the team's real command/subsystem
  code; make simulation integration conditional on desktop simulation.
- Generated simulation artifacts and feedback: \`${build}/\`.
- Project manifest: \`robot.sim.json\`. Paths resolve relative to that file.
- Builders record \`sourceInputs\` in \`scene-bindings.json\`: schema 1 and a files
  array of {file,sha256} for every CAD/physical build input. Paths resolve under
  runtime.assetRoot or the profile directory. Set sourceInputs.root to "project"
  when editable CAD is outside runtime.assetRoot; paths then resolve under the
  profile directory while native collision assets keep their existing root.
  Changed inputs fail audit/startup;
  missing tracking is reported as untracked. Rebuild artifacts and bindings,
  not just fingerprints. Rebuild the actual Java JAR after robot-code changes.
- Source configuration: \`.cadcove/project.json\`. Do not treat generated mesh
  caches, PNGs, or physics state as authoritative design source.

## Work in this order

1. Read \`.cadcove/project.json\` and
   \`.cadcove/skills/references/cad-authoring.md\`. Edit Python, run
   \`cadcove cad-build --workspace .\`, inspect exact geometry with
   \`cadcove cad-inspect --workspace . --script checks.py\`, then capture
   focused views with \`cadcove cad-capture --workspace . --view iso --output build/check.png\`.
   Keep a \`cadcove cad-session --workspace .\` JSONL process open for warm
   build/inspect/export iterations. Build and inspection do not require VS Code;
   capture requires this model's webview open. Read actual images and numerical
   results before accepting a change. Use full CadQuery/OCP; never simplify an
   intended curved/filleted design because a convenience wrapper is missing.
   CAD-only work needs Python/CadQuery, not a simulation JAR/JDK/vendor SDK.
   In source checkouts use \`bun /path/to/CadCove-FRC/bin/cadcove.js\`.
2. Read the team's robot code, CAD inventory, vendordeps, and season assets.
   Identify each motor, sensor, mechanism and physical frame. Ask for unknown
   mass, ratios, mounting directions, travel limits and material/contact data.
   Never reuse another team's CAN IDs, poses, controls or calibrated values.
3. Author native Python/CadQuery models, using stable IDs, local imports, semantic
   comments and explicit colors. Check the viewer's build status/revision and
   inspect its preview after each change. A retained old scene is not proof of
   a successful build. Use assertions for dimensional/clearance requirements and focused multi-view captures. Source is mm/Z-up; physics uses metres/SI. Convert once.
4. Bind physical bodies/joints/motors to CAD occurrences. The native world and
   binding contract is documented in \`.cadcove/skills/references/physics-authoring.md\`.
   Use its synthetic example only to understand the format, not for robot tuning.
   The current viewer
   requires a root body named \`chassis\`. Compile world.json
   and scene-bindings.json into the configured build directory. Bindings must
   pin the exact world hash and the robot/field CAD source hashes.
   A generic CAD-to-mechanism compiler is not yet shipped: integration must
   explicitly construct and validate those files rather than guess mechanics.
5. Run \`cadcove bridge-export --workspace .\`. Apply
   \`apply from: '.cadcove/bridge/instantcad.gradle'\` in this team's Java Gradle
   project. The exported source compiles against its WPILib/Phoenix/Jackson
   versions; resolve compatibility errors rather than substituting another
   team's vendor libraries. Export refuses to overwrite local customizations.
   Read the exported DEVICE-ADAPTERS.md capability matrix before integration.
   Other motor controllers can implement MotorAdapter; unsupported sensors need
   explicit adapters and qualification, never silent substitutions.
   After a toolbox update, run \`cadcove bridge-export --workspace . --review\`.
   This writes a separate versioned review copy and reports per-file differences
   without changing the active bridge. Read/merge the relevant files into
   \`.cadcove/bridge\` while preserving the team's customizations, then rebuild the
   robot JAR. The current CLI requires the bridge to acknowledge its launcher
   watch before reporting ready; an old JAR can fail even when doctor finds it.
   For Java/Phoenix 6, register the existing TalonFX, CANcoder and Pigeon2
   objects with TwinBridge at their construction sites. Start the bridge in
   simulationInit. Bypass other simulation code that writes the same sensors.
   Set runtime.jar and nativeLibraries to this team's actual Gradle outputs.
   Unsupported CTRE devices and C++ adapters require an explicit implementation.
6. Configure season geometry, tags and game rules independently of the robot.
   Limelight-compatible simulated AprilTag output needs measured camera mounts,
   optics, NetworkTables names and latency. It is not actual Limelight firmware.
7. Run \`cadcove audit --project robot.sim.json\`, then
   \`cadcove sim-validate --project robot.sim.json\`. The second command loads the
   pinned world and collision assets in a temporary native process at tick zero
   and waits for its exit. It does not start Java/Phoenix, advance physics, or
   touch an existing session. Use its native errors to fix shape/joint/motor
   parameters before launching the robot; success is not a stepping-stability
   or hardware test. Validation has a 30-second process limit.
   Fix errors, then test each
   motor sign, ratio, joint limit and sensor independently. Verify live practice
   and a scripted full course with the same robot executable. Label gameplay
   approximations separately from detailed physics; never claim hardware
   qualification from a rendering or a clean artifact audit.

## Select practice or detailed physics

Use separate manifests/builds, never relabel a gameplay world as accurate.
\`cadcove sim-mode --project robot.sim.json --mode accurate --output build/detailed\`
preserves the original world. For practice, use \`--mode gameplay --recipe recipe.json\`
and a new output directory. A recipe requires sourceWorldHash from audit, settings,
description and evidence; author it for this robot/field, not another team's demo.
Allowed settings are dt, solver_iterations, soft_contact_max_angle_rad, gameplay,
and fieldFoamSubdivisions. Record approximations, validate with sim-validate, then
stop the old session and start a fresh one using the new manifest. Update
simulationProject in .cadcove/project.json for the editor commands. No mode is a
claim of hardware qualification. Do not change physics to hide controller errors.

## Run and observe simulation

Run \`cadcove sim-run --project robot.sim.json\` as a foreground process. It
emits simulation-ready/stopped JSON events on stdout and robot logs on stderr.
Wait for ready before sending controls. The native engine is included in the
toolbox; the team's built JAR, desktop vendor libraries and WPILib JDK are not.
Set runtime.jdk if automatic installed WPILib JDK discovery selects the wrong
version. Relative collision assets resolve against runtime.assetRoot (default:
the manifest directory). Keep those paths portable inside the team workspace.

Use \`cadcove sim-state --project robot.sim.json\` and
\`cadcove sim-objects --project robot.sim.json --query-file query.json\`.
An object query can contain id (string or array), prefix, limit, after, near
([x,y,z] metres) and radius. Use small queries for agent feedback.
Send one controls packet with
\`cadcove sim-controls --project robot.sim.json --input controls.json\`.
Example: {"mode":"teleop","controllers":[{"port":0,"axes":[0,0,0,0,0,0],"buttons":0,"pov":-1}]}.
Map axes/buttons from the team's actual code. Controls require renewal within
one second; absence of renewal disables simulation. Do not mistake one packet
for a sustained drive action. Send mode disabled after experiments.
Use \`cadcove sim-stop --project robot.sim.json\` to stop the owned robot runtime.
After an abnormal exit, sim-recover removes a lock only if the recorded launcher
and JVM have both exited. It does not kill other processes.

The bridge selects an authenticated loopback port per project. Its private
session file contains credentials: do not commit or share generated build data.
Vendor NetworkTables/Phoenix diagnostic ports are not isolated yet: run one
robot simulation per host until that integration is configured and qualified.
Keep ordinary mechanism tuning in project world data (mass, inertia, geometry,
joints, motors and contact parameters). Use the bundled native engine by default.
For a new force model, use the versioned Rust mechanism interface and a team-owned
binary; set runtime.customSimulator {sourceDirectory, package, binary} in
robot.sim.json, then run \`cadcove sim-build --project robot.sim.json\` explicitly.
Stop simulation before building; restart and run sim-validate afterwards. A custom
binary overrides the bundled one, with no fallback if missing. Read the release's
docs/CUSTOM-SIMULATOR.md and examples/custom-mechanism before extending physics.
Do not edit the underlying Rapier solver for ordinary robot calibration.
The bundled rebuilt-2026 season adapter describes 2026 only. For another game,
read .cadcove/bridge/SEASON-PLUGINS.md and implement a team-owned SeasonPlugin
registered with Java ServiceLoader. Select it explicitly in world.json's season
object and rebuild its hash/bindings. The observer reads immutable body values,
owns scoring/match timing, and must not command motors or move pieces. Native
physics, robot code and rendering remain separate. Never relabel the 2026
observer or the example training game as another season's official rules.
Use sim-match to inspect/start/abort the chosen observer and sim-autonomous for
the actual robot chooser. Renew mode match controls during scheduled play.
sim-devices and sim-motor-controls expose device bindings and host-side control
requests for integration debugging; those are not firmware acknowledgements.

## Feedback and autonomy

After sim-run is ready, open the editor command CadCove: Open Live Simulation.
The robot and field use the same shared CAD renderer, with authoritative physics
poses and presentation-only interpolation. The canvas is view-only: no drive or
mechanism buttons, keyboard driving or browser gamepad polling. For live driving
set runtime.controlSource to "driverstation" and runtime.driverStation to "gui"
in robot.sim.json, then restart. WPILib Sim GUI owns enable/disable and physical
USB controllers. Map the team's actual driver/operator ports there (Amarillo:
driver 1, operator 0); use Map gamepad for Xbox layout. On Windows, "socket"
loads the WPILib DS socket extension for the actual FRC Driver Station.
Changing canvas focus does not disable the external Driver Station. Disable in
Driver Station before editing robot code or restarting. Do not auto-enable it.
For agent trials use runtime.controlSource "agent", remove runtime.driverStation,
and restart. This headless mode accepts leased sim-controls and scripted matches;
Driver Station mode rejects those so there cannot be two competing input owners.

\`cadcove sim-viewer-state --project robot.sim.json\` reports the open canvas.
\`cadcove sim-view --project robot.sim.json --options view.json\` accepts
{\"view\":\"iso\",\"follow\":false}, {\"fit\":true}, or an explicit camera
{target:[x,y,z],distance,yaw,pitch} in metres/radians.
\`cadcove sim-capture --project robot.sim.json --options capture.json\` creates
a fresh PNG and returns its path, SHA-256, run ID, world hash and physics tick.
Capture options: scope robot/field/scene (default robot), bodies (physical IDs),
view front/right/top/iso, width/height (at most 2048), and optional camera.
Captures fit the selected geometry without changing the student's camera.
Read the returned image with your own image tool; never invent visual feedback.
Use sim-controls for scripted controller packets in agent mode. sim-practice is
not supported by the view-only canvas. Viewer CLI commands require the local
editor panel to be open; they do not expose a public server.

Run \`cadcove cad-status --workspace .\` and \`cadcove cad-preview --workspace .\`
for source-revision-checked CAD feedback and the last build preview path. Read
the PNG with your own image tool. A stale result means the latest source has not yet been built; run cad-build; do not treat the old picture as confirmation.
Use the CAD viewer's disk status/preview and simulation state/object queries
before requesting additional screenshots. Inspect the installed viewer contract
for the configured cache paths. Do not fabricate passing feedback files. Keep
edits reviewable and record measured/derived/estimated/unknown provenance in
robot.sim.json. Request only facts that cannot be inferred reliably from source.
Never deploy robot code to hardware as part of a simulation-only task.
`;
  const files = new Map([
    ...Object.entries(agentGuidanceFiles()),
    ...Object.entries(await cadReferenceFiles()),
    ['robot.sim.json', JSON.stringify(profile, null, 2) + '\n'],
    ['.cadcove/project.json', JSON.stringify({schema: 1, sourceDirectory: cad, buildDirectory: build, entryPoint: (await existing(path.join(root,cad,'models.py'))) !== null ? 'models.py' : (await existing(path.join(root,cad,'model.py'))) !== null ? 'model.py' : 'models.py', simulationProject: 'robot.sim.json'}, null, 2) + '\n'],
    ['.cadcove/AGENT.md', instructions],
  ]);
  if(guidanceOnly)return updateManagedGuidance(root,files,{dryRun,entrypoints:true});
  files.set(guidanceStateFile,guidanceState(files));
  for (const {file,content} of await agentEntrypointChanges(root)) files.set(file,content);
  const changes = [];
  for (const [file, content] of files) {
    await checkPath(root, file);
    const old = await existing(path.join(root, file));
    const instruction = agentEntrypoints.includes(file);
    if (old !== null && old !== content && !instruction) throw Error(`Refusing to overwrite ${file}; use its existing configuration`);
    if (old !== content) changes.push({file, content, previous: old});
  }
  for (const dir of [cad, build]) {
    await checkPath(root, dir + '/.cadcove-path-check');
  }
  if (!dryRun) {
    await mkdir(root, {recursive: true});
    for (const change of changes) {
      const file = path.join(root, change.file);
      await mkdir(path.dirname(file), {recursive: true});
      // Detect ordinary concurrent edits before appending generated guidance.
      if (await existing(file) !== change.previous) throw Error(`File changed during initialization: ${change.file}`);
      if (change.previous === null) await writeFile(file, change.content, {flag: 'wx'});
      else await writeFile(file, change.content);
    }
    for (const dir of [cad, build]) await mkdir(path.join(root, dir), {recursive: true});
  }
  return {schema: 1, ok: true, command: 'init', workspace: root, dryRun, files: changes.map(c => c.file), sourceDirectory: cad, buildDirectory: build, integrationRequired: true, next: ['Read .cadcove/AGENT.md and .cadcove/skills/references/cad-authoring.md', 'Write the configured Python entry and run cadcove cad-build --workspace .; right-click it to open the WebGPU canvas', 'Before simulation: cadcove doctor --project robot.sim.json and integrate this robot']};
}

export async function updateToolboxGuidance({workspace,dryRun=false}){
  if(!workspace)throw Error('--workspace is required');
  const root=await realpath(path.resolve(workspace));
  await checkPath(root,'.cadcove/project.json');
  const config=JSON.parse(await readFile(path.join(root,'.cadcove/project.json'),'utf8'));
  if(config.schema!==1||typeof config.sourceDirectory!=='string'||typeof config.buildDirectory!=='string')throw Error('Initialize this workspace before updating guidance');
  return initializeToolbox({workspace:root,cadDirectory:config.sourceDirectory,buildDirectory:config.buildDirectory,dryRun,guidanceOnly:true});
}
