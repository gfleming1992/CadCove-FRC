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
Native `sim-validate` checks the resulting native world before execution.

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
