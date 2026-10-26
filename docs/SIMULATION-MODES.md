# Live practice and detailed simulation

| Mode | Purpose | What to measure |
| --- | --- | --- |
| `gameplay` | Interactive driving with declared, robot-specific approximations | Input delay, timestep deadlines, intake/storage/shot behavior, disabled/focus-loss response |
| `accurate` | Original detailed world for background mechanism and controller trials | Contacts, clearances, energy, convergence at finer timesteps, calibration against measurements |

Both run native Rust physics with actual compiled robot code. Detailed trials
may run slower than real time. Neither mode is hardware certification. A clean
CAD picture, score or artifact audit alone does not establish accurate dynamics.

## Build separate profiles using the installed CLI

Start from an integrated detailed `robot.sim.json`. Query `cadcove audit --project
robot.sim.json` for its exact `worldHash`. A practice recipe contains:

```json
{
  "sourceWorldHash": "REPLACE_WITH_THE_64_CHARACTER_SOURCE_WORLD_HASH",
  "description": "Team practice solver trial; unchanged geometry",
  "evidence": "Proposed trial, not yet calibrated; compare telemetry against detailed mode",
  "settings": {"solver_iterations": 4}
}
```

The value 4 is an example experiment, not a universal recommended solver setting.
Advanced recipes may explicitly declare `dt`, `soft_contact_max_angle_rad`,
`gameplay` mechanism transport, and `fieldFoamSubdivisions`. Author them for the
actual robot and season; the CLI does not infer conveyors or tune mechanisms.
A recipe with `gameplay.robot_compliance: true` retains the authored ball
materials and all mechanism activation zones, including moving robot zones. It
requires passive storage and physical launcher pickup regions. Field-only foam
and robot compliance are mutually exclusive; neither changes the detailed source.
In robot-compliance mode, a ball at a physical pickup can join and remain in
the feeder inventory even when its reserved storage slot is elsewhere. Inventory
membership applies no holding force. Once outside pickup and more than 0.35 m
from that storage target, the ball is released to the field inventory.
Native `sim-validate` checks the resulting native world before execution.

`solver_schedule` defaults to `per_refresh`: each collision refresh runs
`solver_iterations` base temporal substeps. An explicit `per_tick` recipe instead
uses `ceil(solver_iterations / collision_refreshes)` base substeps per refresh,
with at least one. This preserves the nominal maximum internal timestep and all
collision refreshes; adaptive island substeps remain enabled. It changes the
numerical trajectory and needs mechanism and whole-match validation. It is not
a guarantee of equal accuracy or real-time performance. The native runtime must
advertise `solver-schedule-v1`; launch and validation reject older runtimes.


```sh
cadcove sim-mode --project robot.sim.json --mode accurate --output build/detailed
cadcove sim-mode --project robot.sim.json --mode gameplay --recipe practice.json --output build/practice
cadcove sim-validate --project build/practice/robot.sim.json
```

The output directory must be new and its parent must exist. Detailed mode keeps
world bytes unchanged. Practice requires a matching source hash, description,
evidence and allowed settings. CAD, source tracking, collision assets and robot
code remain referenced through relocated paths. Keep the whole workspace when
moving these builds. The command copies no credentials and changes no session.
Rebuild modes after changing their source world; never relabel an approximate
world as accurate. A practice result is not the detailed result.

Stop the running session before switching. Set `simulationProject` in
`.cadcove/project.json` to `build/practice/robot.sim.json` or
`build/detailed/robot.sim.json`, then use **Start Robot Simulation** and **Open
Live Simulation**. Agents can instead pass the manifest explicitly to `sim-run`.
Run one robot session per host until vendor diagnostic port isolation is qualified.

## Regression loop

1. Build the real robot JAR and native world/bindings after source changes.
2. Run `doctor`, `audit`, `sim-validate`; resolve failures and record assumptions.
3. Start a fresh session and wait for its ready event. Validate device signs,
   ratios, joint limits and controller button mappings in isolated trials.
4. Use filtered `sim-objects` and `sim-state` for behavior, `sim-capture` for
   revision/tick-matched visual evidence. Renew control leases during actions.
5. Compare identical initial scenarios across modes. Record jams, missed shots,
   intersections, wall/simulation time, p95 deadlines and observed scores.
6. Stop/disable controls and retain source hashes, settings and measured limits.

Practice storage slots must fit the actual CAD and retain ball collisions.
Reduced intake/feed transit remains approximate. Seasonal goals must discharge
pieces according to the authored field mechanisms; accumulating balls in a closed
visual goal is not automatically realistic. Investigate controller calculations
and mechanism geometry before changing physics to improve a demo's score.

## Live performance logging

The native engine emits one compact JSON `physics-performance` record to stderr
per five seconds of stepping, enabled by default. Managed `sim-run` sessions
retain this in their `robot.log`; the Java bridge also retains the latest window
as `physicsPerformance` in `sim-state` / `/state`. Reset starts a new window.
`CADCOVE_PHYSICS_LOG=0` disables the summaries. No geometry, body names, controller
inputs or per-contact traces are logged. Window storage is fixed size.

- Every request measures native physics, snapshot/delta construction, maximum,
  half-millisecond histogram p95 upper bound, and native deadline misses.
  Batched requests use their full simulated duration as the budget. An overflow
  p95 is null, with `physicsOver100Ms` recording requests at or above 100 ms.
- One in twenty requests samples stage timers and peak awake/sleeping bodies,
  awake sphere bodies, soft bodies, and active contact pairs (sphere/sphere,
  sphere/fixed, sphere/other). These are **sampled** peaks, not exhaustive maxima;
  sphere classification is geometry-based and includes non-game-piece spheres.
  Counts describe the final substep; timings sum all substeps in the request.
- `sampledStageMeanMs` averages only sampled requests. `pipelineMs` contains
  nested broad/narrow/solver/CCD stages; do not add them together.
  `ccdToiMs` measures the actual continuous-collision sweep timer; it is not
  Rapier’s unused aggregate CCD stage timer.
  `outsidePipelineMs` includes compliance updates, motors and gameplay work;
  transmission time is a nested portion. No per-contact or per-CCD-body tracing
  is enabled for these summaries.
- `nativeBudgetUsedRatio` compares physics plus snapshot time with simulated
  time. Values above 1 cannot meet real time even before Java/robot code, IPC,
  serialization and rendering. Values below 1 do **not** establish end-to-end
  real-time performance. Use bridge `pace` and `stepMs` alongside it. Window
  wall time can include pauses and is not a CPU-utilization measurement.

Start with these summaries during play. Rising awake-sphere counts and narrow
phase time suggest field/collider work; rising solver time and contact counts
suggest dense contact islands. Elevated soft-body counts identify compliance
work. Enable `INSTANTCAD_PROFILE=1` only for short diagnostic runs when individual
contact and CCD traces are necessary; it has greater overhead and payload size.
Ground-level game pieces are still 3D rigid spheres: a planar approximation would
need explicit promotion for piles, ramps, airborne shots and robot contact, and
must remain an opt-in gameplay mode rather than silently alter detailed trials.

The Java bridge sends exact changed-state deltas by default. This changes only
transport, not timestep, precision, or contacts. `INSTANTCAD_STATE_DELTA=0` restores
full snapshots for comparison. Loads always establish a full baseline; subsequent
deltas must match its tick. Busy scenes may still change most of the state.

## Gameplay stress qualification

Exercise both the full robot-code loop and isolated native replays. Cover idle,
acceleration/braking/reversing, sustained turning, wall contact, driving into a
pile while collecting, full cargo, rapid volleys, hub return, many rolling balls,
and many airborne balls. Include a continuous driving run, not only short bursts.
Synthetic mass drops are useful overload probes; report them separately from
ordinary driving. Keep scenario worlds, input schedules, binary/world hashes and
results together outside the public source export when they contain private CAD.

For each scenario record simulated/wall time, all-tick deadline misses, step-time
distribution, native stages, IPC bytes/time, robot callbacks, moving-ball and cargo
counts, and capture/launch/return outcomes. HTTP polling only samples step times:
label its percentiles as observed, and use native window counters for exhaustive
native timing. Native throughput is not viewer FPS. Run tracing separately from
timing, and avoid builds or other benchmarks during measurements.

Compare worker counts using the same native inputs and final-state hashes. Test
larger gameplay timesteps in a separate profile and verify driving, launch and
collision behavior; better pace alone does not qualify them. A crowded scene's
cost may be detailed chassis/field CCD or state transport, rather than sphere
solving. Use the measured stage breakdown before choosing a planar ball model,
coarser collision proxies, or a transport change. Keep accurate-mode geometry and
settings available independently.

### Contact-only subsystem experiments

`cadcove sim-manipulate --project robot.sim.json --input move.json` provides a
finite-force virtual hand in the running full simulator. MCP exposes the same
contract as `simulation_manipulate_game_piece`. Query object IDs first. Example:

```json
{"action":"move","id":"ball-id","frame":"shooter-body-id",
 "position":[0,0,0.1],"duration":3,"max_force":5,"max_speed":0.15,"hold_seconds":1}
```

Coordinates are metres in the optional live rigid-body frame (world otherwise).
The target starts at the current ball position, travels linearly over `duration`,
holds for `hold_seconds`, then releases automatically. The force-limited velocity
servo retains contacts and soft-body deformation; an obstruction can stop the
ball from reaching its target. Force is capped in newtons, commanded speed in
metres/second. A moving frame may make the target unreachable at that speed.
This is an external test fixture, not a model of a human hand.

Use `{"action":"release","id":"ball-id"}` to release early, or
`{"action":"status"}` to read active tracking errors and applied forces. Release
preserves physical velocity. Manipulated bodies bypass practice capture,
conveyor ownership and automatic launch, including after release. Explicitly use
`{"action":"restore_gameplay","id":"ball-id"}` after release to restore those
approximations. A match reset also resets these transient controls. Motors are
not enabled by this command. Motor control remains with the selected control
owner. Camera and rendering are unaffected; no geometry rebuild is needed.

An exiting ball is not automatically a successful shot. Inspect contacts,
trajectory, motor speed and tracking error; report jams and escapes. The API
does not infer material calibration or declare hardware performance verified.


## Gameplay cadence and isolated numerical batches

A gameplay profile can explicitly select `dt: 0.02` (50 Hz), with
`solver_schedule: "per_tick"` and `max_contact_substeps: 1..64`. The optional
contact budget caps the adaptive **whole-world collision refreshes** per tick;
it does not cap Rapier's local solver refinement or CCD. Without it, the original
motion-driven refresh policy remains in effect. This trades contact accuracy for
cost and may change pickup, jamming, penetration and shot outcomes. It is not a
local collision scheduler. `minimum_substeps` above the selected budget is
rejected; use a separate finer world for offline work. Detailed profiling reports
both requested and applied refresh counts and the selected cap. Runtimes must
advertise `contact-refresh-budget-v1` to accept this setting through managed tools.

Evaluate gameplay against practical requirements: controllable driving and
braking, robot contacts, ball pickup/release, volleys, conservation of game pieces,
bounded penetration/energy, and measured tick deadlines. Exact agreement with a
fine-step trajectory is not a gameplay acceptance requirement. Record the
scenario and numerical settings alongside results; a clean finite-state check
alone does not establish playability or real time.

Agents can run independent, unpaced mechanism/world trials with:

```sh
cadcove physics-batch --world build/world.json --input trials.json --output build/trial-report.json --asset-root .
```

The output file must be new. This starts only native physics, and does not load
CAD graphics, start robot programs or change a live session. The input is:

```json
{
  "profiles": [
    {"id": "play-50hz", "settings": {"dt": 0.02, "solver_schedule": "per_tick", "max_contact_substeps": 2}},
    {"id": "offline-200hz", "settings": {"dt": 0.005, "solver_schedule": "per_refresh", "max_contact_substeps": null}}
  ],
  "segments": [{"seconds": 1, "volts": {"motor": 2}}],
  "checks": {"maxLinearSpeed": 15, "joints": [{"id": "shaft", "min": 0.1, "max": 6.3}]}
}
```

Replace motor/joint IDs and acceptance ranges with those of the subsystem. Each
profile starts from the same source poses. Null `max_contact_substeps` removes a
cap for offline checking. Finer timesteps do not remove gameplay approximations
or establish hardware calibration. Supported timestep range is greater than zero
through 20 ms. Segment boundaries are quantized to ticks; the report records
actual applied tick ranges. Limit: eight profiles, 600 simulated seconds and
500,000 ticks per profile. Voltages are bounded to ±12 V. Every returned tick is
checked for finite body/joint states and unique robot inventory. Optional speed
limits apply throughout the trial; position and joint ranges apply at the end.
Without explicit acceptance criteria, `accepted` is null, even if structural
checks pass. Reports include source-world, selected-world, plan and binary hashes,
final state, simulated/elapsed time and observed maximum linear speed. Asset
files referenced by path must remain unchanged during a run; their contents are
not included in these hashes. This is an open-loop native experiment, not a
closed-loop WPILib test or a match throughput benchmark.

The editor MCP exposes `physics_batch_start`, `physics_batch_status`, and
`physics_batch_cancel`. Start returns a job ID while a native process works in the
background; the editor stays available. One batch runs at a time, with profiles
executed sequentially. It defaults to the configured simulation world; an
optional workspace-relative `worldFile` selects an exported subsystem native
world (assets resolve relative to that file). Poll status for progress and the
saved report path. Cancellation and editor shutdown terminate the owned native
process. The batch uses isolated state; changes to CAD or a running match do not
update an already-started trial. Validate report source hashes before using it
for a later revision. Background computation still competes for CPU with live
play, so do not run it during a throughput benchmark.

## Physics-definition edits

Collider, mass, inertia, and joint definition edits invalidate the running simulation.
The entire scene prepares and validates asynchronously, then returns to authored
initial conditions with motor commands cleared. Explicit start is required; no
poses, velocities, or contact caches transfer across a changed definition.
All components must finish validation before starting. Camera, selection, and
isolation remain presentation state. Ordinary motor commands do not rebuild.

### Opt-in live deformable surface stream

The unified native mechanism canvas can stream explicitly authored compliant
spheres to the same GPU deformation backend used by recorded replays. Return to
stopped CAD mode, then use `canvas` action `physics-particles` with options
`{"action":"enable","bodyIds":["ball-body-id"],"maxHz":20}`. Query with
`{"action":"state"}` or disable with `{"action":"disable"}`. Enabling does not
start physics, drive a motor, or feed a ball; use the usual physics controls later.
Rigid-only bodies are rejected. Material/compliance values must already exist in
the validated physical definition; this command does not infer or author them.

This is deliberately bounded to one connected native physics component, one to
four selected spheres, subdivisions zero through two (at most 163 particles per
sphere), and one to thirty samples per second. After an ordinary native step,
serialized read-only particle queries retrieve only active compliant bodies.
There is no extra physics step or client prediction. Inactive bodies use their
existing rigid visual. Topology is sent once per stream; subsequent samples carry
only body representation and particle coordinates, with authoritative tick/time
and physics revision. Samples between the configured rate limit are omitted.

Enabling allocates presentation topology once and preserves the camera. Updates,
soft/rigid switches and invalidation reuse the CAD GPU buffers. Particle positions
and normals are evaluated on the GPU; the CPU validates/packs incoming particles,
not the surface vertices. CAD reset, stale source revisions, disposal and failed
physics preparation retire the presentation. Return to CAD and re-enable after a
reset. Placement currently supports translation only. Captures use the deformed
GPU geometry; CPU mesh picking/export still uses authored CAD geometry.

This path is supported by the direct native mechanism session. The separate
WPILib-managed match transport does not yet forward soft particles. A synthetic
native sphere and real WebGPU integration test verify transport, visible motion,
rigid fallback, source/stream/tick rejection and resource cleanup. They do not
qualify any team's foam material, shooter behavior or full-match performance.
