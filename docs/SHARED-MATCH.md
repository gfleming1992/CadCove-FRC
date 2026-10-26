# Experimental shared robot matches

`composeMatchWorld` in `lib/match-world.js` composes 2–6 copies of one robot
package into one native physics world. `startMatch` in `lib/match-coordinator.js`
provides a loopback JSONL connection for each independently running WPILib JVM.
The experimental `match-serve` command adds browser driving and client-side
rendering, described below. The normal single-robot launch path remains available.

The composer requires explicit robot body membership, a chassis, the existing
robot collision group 1/filter 6 convention, and a single gameplay package.
Robot bodies, joints, motors, transmissions and compliance zones receive stable
`r0/` through `r5/` prefixes. Field geometry, conveyors and game pieces occur
once. Robot collisions exclude their own robot and include the other robots.
Spawns transform initial position, orientation and velocity. Collider files stay
relative to the shared asset root. Custom `mechanisms` packages and robot joints
or transmissions attached to the field are rejected by this initial composer.

The native `robot_gameplay` map holds additional mechanism runtimes. Every robot
uses the same ball pool; inventory ownership is checked across all runtimes.
Primary gameplay owns the shared field conveyors. Ball placement clears any
robot's ownership. Physics snapshots and deltas contain per-robot gameplay
status. Capture arbitration currently follows deterministic robot order; it is
not a claim of competitive fairness for simultaneous reduced-order captures.

Start the coordinator with the composed `world`, `robots`, native `binary`, and
`assetRoot`. Its result supplies a loopback `port`, a random `token`, a native
process `pid`, the authoritative `snapshot`, a `failure` status, and `close()`.
Launch each precompiled program with its original local actuator/body IDs and
its corresponding transformed `robots[i].world`. In addition to the normal
bridge environment, supply:

- `CADCOVE_MATCH_PORT`: the returned loopback TCP port.
- `CADCOVE_MATCH_ROBOT`: the assigned robot ID.
- `CADCOVE_MATCH_TOKEN`: the returned token, kept out of logs.
- A distinct `INSTANTCAD_BRIDGE_PORT` and working directory per program.
- `INSTANTCAD_ALLIANCE_STATION=Blue1|Blue2|Blue3|Red1|Red2|Red3` for each
  agent-controlled robot. Omission retains the legacy Blue1 default. External
  Driver Station control retains its own station identity.
- `INSTANTCAD_CLOCK=physics`, `INSTANTCAD_CONTROL_SOURCE=agent`, and
  `INSTANTCAD_ALLOW_RESET=0` for coordinator-driven benchmarking.

Each JVM owns its HAL, vendor device state, sensors and robot program. The bridge
opens a coordinator socket instead of starting another physics process. It
stops its default NetworkTables server and Phoenix diagnostics server in this
mode to avoid duplicate listeners. Other team code that starts fixed-port
servers still needs isolation or explicit configuration.

The coordinator waits for all participants' motor commands before advancing one
shared tick, then returns each program its own robot state and the shared field.
The coordinator also owns wall-clock pacing. Updated bridges advertise
`coordinatorPacing: true` when joining and disable their independent gameplay
timer only after the coordinator acknowledges `pacing: "coordinator"`.
Re-export and compile older bridges before joining this protocol. Standalone
simulations retain their existing timer. The shared clock corrects small timer
jitter, discards wall-clock debt beyond one tick after overload, and never skips
physics or robot callbacks to catch up. A waiting pacing timer is canceled on
disconnect or shutdown.
It combines fixed field drives once. State deltas are relative to that client's
previous response. A participant cannot reload or reset the match. A disconnect,
invalid participant operation or missed shared-clock deadline fails the match;
the owner must call `close()` in a `finally` block to release the process and
sockets. The owner may inspect `failure` while driving controllers. This
lockstep implementation prioritizes coherent simulation over real-time pacing;
a slow program slows the match. Arbitrary team code is not sandboxed by this API.

Portable tests cover composition, collision filtering, coordinate transforms,
actuator isolation, the tick barrier, client deltas and disconnect behavior.
Native tests cover shared-ball ownership and invalid gameplay configurations.
Hardware performance, browser codecs and vendor integration require separate
measurements on the target machine. A loopback WebRTC benchmark also includes
receiver decoding, which a dedicated remote server would normally avoid.

## Browser driving with authoritative server state

`cadcove match-serve` launches the shared native world, one precompiled robot
program per robot, and an HTTP/WebSocket endpoint. The server does no drawing,
GPU initialization, video encoding or tessellation. Each browser preloads the
versioned CAD meshes, reuses geometry across robot copies, and renders incoming
body transforms. Only the server runs robot code and physics. Clients hold the
last received pose until the next update: there is no prediction, extrapolation
or interpolation. Camera movement is local and is preserved across pose updates
and reconnections; following a robot is optional.

The match renderer uploads one matrix per moving rigid body and composes the
fixed CAD-part offsets in a GPU compute pass. Detail levels share that same body
transform. Every network delta is decoded, but rendering consumes only the
latest received state once per frame; this introduces no prediction or
interpolation. One GPU frame is allowed in flight, preventing a slow client from
building a queue of stale frames. Hidden tabs stop drawing and resume from the
latest received state.

Graphics defaults to **Auto**: at most 1920×1080 pixels (with the actual aspect
ratio preserved), capped device-pixel ratio, screen-error detail selection,
frustum/subpixel culling, shared mesh instancing and cached opaque draw commands.
Sustained slow completed frames gradually reduce resolution; recovery is slower
to avoid oscillation. **Performance** caps rendering at 1280×720 pixels and uses
a slightly larger visual error budget. **High** allows up to 2560×1440 pixels.
These are visual controls only; they do not change colliders, physics precision,
robot code, or authoritative body state. The footer reports actual render size.
Midrange hardware suitability must be measured on that hardware; software-GPU
checks and measurements on another GPU do not qualify a device class.

Run from source with:

```sh
bun bin/cadcove.js match-serve --config /path/to/match-server.json \
  --output /path/to/new-session-directory
```

The configuration uses paths relative to its own directory. `match` points to a
JSON object containing the `world` and `robots` returned by `composeMatchWorld`.
Provide 2–6 programs in matching robot order, each built with the current
TwinBridge. Set each program's optional `station` to its actual driver station
(e.g. Blue1 and Red1); the launcher verifies the bridge applied it before starting
the match. The default remains Blue1 for older practice configurations. Alliance
affects team-code aiming, paths and field-relative driving; spawn yaw alone does
not establish an alliance. The ready events and session manifest report actual
stations. A two-robot example is:

```json
{
  "schema": 1,
  "match": "match.json",
  "assetRoot": "physics-assets",
  "cad": {
    "robot": "cad-assets/robot",
    "field": "cad-assets/field",
    "bindings": "build/cadcove-agent/scene-bindings.json"
  },
  "stateHz": 60,
  "programs": [
    {
      "robotId": "r0", "station": "Blue1", "cwd": "runs/r0", "bridgePort": 18910,
      "command": ["java", "-Xmx512m", "-Djava.library.path=/path/to/jni",
        "-jar", "/path/to/precompiled-robot.jar"]
    },
    {
      "robotId": "r1", "station": "Red1", "cwd": "runs/r1", "bridgePort": 18911,
      "command": ["java", "-Xmx512m", "-Djava.library.path=/path/to/jni",
        "-jar", "/path/to/precompiled-robot.jar"]
    }
  ]
}
```

Each working directory must exist and contain the deploy files expected by that
robot program. Program arguments are passed directly without a shell. Optional
`nativeBinary` selects a native executable relative to the configuration; the
packaged runtime is the default. Each program can supply an `env` object for
team-specific settings; the coordinator overrides its required bridge settings.
Commands are trusted local programs, not remotely uploaded code or a sandbox.

The ready event and `session.json` contain separate driver links and a spectator
link. Treat driver links as credentials. The file is created with owner-only
permissions on systems that support them. Open a driver link, wait for asset
preloading, and click Enable. The first gamepad maps to driver port 1 and the
second to operator port 0. Keyboard controls are WASD to drive, Q/E to turn,
Shift for slower movement, F/R for operator B/A, and Space for the operator right trigger.
Disable, loss of focus, a hidden tab, controller disconnect, socket disconnect,
or a 500 ms input gap disables that robot. Reconnection never enables it
automatically. After a timeout, the client must acknowledge the disabled state
before enabling again. Stopping the session terminates its robot programs and
native process.

The server accepts controller values only; it assigns the robot from the driver
credential and rejects client poses, voltages or other robot IDs. Each driver has
one active connection. A bridge run ID, control stream and sequence fence stale
commands. Inputs are coalesced while each robot's HTTP control request is in
flight. A stopped or slow browser cannot block physics advancement.

Pose frames contain tick/time and binary float32 position/quaternion records.
The server encodes one shared delta against the previous published scene and
reuses its bytes for all synchronized clients. New, resynchronizing, or lagging
clients receive a shared full frame instead; a full frame is also published
every two seconds of active updates. Camera selection and visual culling remain
client-side. The timer publishes at most 60 times per second when the
authoritative tick changes. A join or resync can additionally publish at the
current tick, advancing all connected clients to the same sequence. Slow connections skip unsent intermediate states and are disconnected
if their output queue remains congested. Already queued WebSocket bytes remain
ordered: TCP retransmissions can delay newer poses. This is a first transport,
not a claim of equal WAN latency to WebRTC's video or unreliable data channels.
There is no server render/encode or client decode stage in the transform path;
client graphics cost, network loss and physics cadence still determine response.

CAD files are allowlisted, hashed and served under a revision URL. Browsers
verify content hashes before loading or reusing cached geometry. Changing CAD
assets requires starting a new session; assets cannot silently change beneath
an active match. Only mesh/assembly/appearance data used for rendering is served,
not robot source or physics asset directories.

The default listener is loopback. `--host 0.0.0.0 --port 8080` explicitly binds
other interfaces. Remote WebGPU needs a secure browser context: deploy behind an
HTTPS/WSS reverse proxy, preserve WebSocket upgrades, and configure
`allowedOrigins` with the exact external origins if the proxy changes the
upstream origin. This command supplies role credentials and input isolation,
not public hosting accounts, billing, hostile-program isolation or a complete
internet service. Share only the intended role link.

`bun run test:match-browser` checks the actual WebGPU client with small public
fixtures, including camera preservation, controller routing, server-only
movement and holding poses between updates. Portable tests exercise binary
frame validation, authentication, role isolation, timeout handling and immutable
asset revisions. Real robot, hardware, latency and streaming comparisons require
separate measurements; publishing at 60 Hz cannot make slow physics real-time.


## Offline visual detail levels

The full CAD tessellation can be much heavier than a game mesh. Bake a separate
visual package before starting the match:

```sh
bun bin/cadcove.js match-visuals --robot /path/to/cad-assets/robot \
  --field /path/to/cad-assets/field --output /path/to/new-visual-package
```

Point `cad.robot` and `cad.field` at the generated `robot` and `field`
subdirectories. Keep `cad.bindings` pointing at the original scene bindings.
The baker retains source IDs, colors, placements and the original tessellations,
and adds three meshoptimizer detail levels with requested absolute error limits
of 0.25, 1 and 4 mm. Its report records the achieved errors and triangle counts.
Original CAD files, physical masses, collider geometry and joints are unchanged.

The match viewer selects detail using projected error (a 1.5-pixel budget),
culls bounding spheres outside the camera frustum, and omits objects whose
projected diameter is below half a pixel. Close objects retain more detail.
This does not perform occlusion culling. Geometry is shared between robot copies;
the manifest verifies every original and simplified mesh before use. Assets are
preloaded, including all detail levels, so runtime selection needs no network
request. More geometry memory and preload time are the tradeoff.

This is a desktop WebGPU renderer. Local camera updates support the planned VR
architecture, but stereo rendering, headset integration and VR frame deadlines
still require implementation and measurement on actual headsets.

## Headless controller benchmarks

For a dedicated x86 host experiment, build `instantcad-sim` with
`--features composite-compact,simd8,x86-support-batch` and
`RUSTFLAGS="-C target-cpu=native"`. `simd8` enables Rapier's eight-lane solver;
the x86 support batching path requires AVX2. Build and run on the target host,
retain the compiler/CPU/features and binary hash with results, and compare
against the portable four-lane build. CPU-specific binaries must not replace
the portable distribution runtime. Benchmark several `RAYON_NUM_THREADS`
values alongside the actual robot JVMs: more workers are not necessarily faster.
Keep the world timestep and solver settings fixed when comparing these builds,
and retain behavior checks because SIMD grouping can change trajectories.

`match-benchmark` runs the same native world and precompiled robot programs with
no browser, CAD asset loading, rendering or encoding. It accepts the same server
configuration; the `cad` section is optional in this mode.

```sh
bun bin/cadcove.js match-benchmark --config /path/to/match-server.json \
  --scenario /path/to/scenario.json --output /path/to/new-benchmark-directory
```

A scenario schedules controller states in simulated seconds from the end of
program startup:

```json
{
  "schema": 1,
  "duration": 15,
  "phases": [
    {"at": 0, "robots": {}},
    {"at": 2, "robots": {
      "r0": {"enabled": true, "controllers": [
        {"port": 1, "axes": [0, -0.4, 0, 0, 0, 0], "buttons": 0, "pov": -1}
      ]}
    }},
    {"at": 10, "robots": {}}
  ]
}
```

Each phase replaces the complete input state: omitted robots are disabled.
Include all six robots to exercise a full match. Commands go through the real
WPILib bridge; phases are delivered on the next controller polling opportunity,
so the recorded motor inputs are the exact replay evidence.

`benchmark.json` contains simulated/wall time, physics and native exchange mean,
p95/p99/max, missed step budgets, sampled robot positions/gameplay, final state,
configuration/scenario/native hashes, sampled process RSS and thermal observations.
RSS includes coordinator, native physics and robot JVMs; shared pages may be
counted more than once, and sampled peaks can miss short spikes. `measured-inputs.json`
contains motor inputs including startup ticks; `measuredInputStart` identifies
the measurement boundary. Program logs and the native physics log are retained.
Interrupted runs retain partial timings, final available state and inputs, and
are marked unsuccessful. The report is local engineering evidence, not a public artifact: it can contain
team-specific world and controller data.

On macOS the runner samples the OS thermal state and Low Power Mode. A run is
classified as OS-nominal only when every observation reports nominal and Low
Power Mode is off. Other platforms or unavailable telemetry remain unknown.
Timings are measured and never scaled by a hypothetical unthrottled multiplier;
nominal OS telemetry does not prove a fixed CPU frequency. Compare identical
input traces in otherwise idle runs, without concurrent rendering or builds.
When a numerical setting such as `solver_schedule` changes trajectories, also
rerun the complete controller scenario with every robot program receiving live
sensor feedback. Replaying old motor voltages cannot measure how those programs
respond to the changed world. Inspect ball ownership, launches and conservation
alongside timing; finite body states alone do not establish correct gameplay.
Physics profiling can be toggled with the native `profile` operation, but detailed
trace overhead should be excluded from final performance comparisons. Per-pair
`contactPairsLastSubstep` diagnostics include total `milliseconds`,
`manifoldMs` for geometry queries, and `softAugmentationMs` for predictive
soft-rigid vertices and overlap patches. These are worker durations from the
last substep, so their sum is not elapsed narrow-phase wall time. Skipped and
soft-soft paths report zero for the two soft-rigid stage fields.


Numerical gameplay experiments can select a 20 ms outer tick (50 Hz),
`solver_schedule: "per_tick"`, and an explicit `max_contact_substeps` budget in
**both** the combined world and every robot's bridge world. Changing only one
side gives the program and physics different clocks. Preserve full copies of
these settings in benchmark configuration hashes. A budget limits global
collision refreshes; it does not implement island-local collision detection.
Evaluate ball handling and controllability alongside real-time ratio. A smaller
step is an offline validation option, not an automatic gameplay requirement.
Use `physics-batch` for independent native subsystem sweeps; it does not replace
the six-program closed-loop benchmark.


Headless benchmark `behavior` summaries record observed cross-robot contact
ticks/pairs and each chassis's traveled path, maximum linear speed, vertical
range and minimum upright-axis projection. These summaries use actual returned
physics states; they do not infer contacts from nearby bounding boxes. They are
evidence to compare with scenario-specific acceptance ranges, not an automatic
playability verdict. The report also retains the bridge-reported station map.

The behavior report also records the minimum planar separation of chassis origins
and each robot's distinct inventory IDs observed during the run. Comparing those
IDs with authored scenario placements distinguishes field collection from merely
launching preloaded cargo. Chassis-origin separation is a coarse overlap screen,
not a collision-surface penetration measurement. Use path length rather than
start-to-finish displacement when a driving scenario returns to its starting area.


The native `contact_groups` operation inspects candidate groups for local stepping
without advancing or changing the world. It returns the tick, outer-tick horizon,
body groups, largest group, and dependency reasons (`joint`, `transmission`,
`contact`, `swept_bounds`, or soft-body links). Dynamic bodies sharing a fixed
floor remain independent. Belts couple shafts even across separate fixed supports.
Sweeps honor collision masks, include sleeping dynamic bodies, and cover the
intermediate orientation of rotating shapes. The capability is
`contact-groups-inspection-v1`.

This is an inspection facility, **not an implemented local stepping scheduler**.
Swept bounds use current motion plus gravity; new motor acceleration, contact
impulses, gameplay ownership transitions and custom mechanism actions require
additional checks before groups could safely execute independently. A live
scheduler must refresh local collision geometry, merge interacting groups, and
finish every group at the same global timestamp before publishing state. Run
inspection outside timed benchmarks; it intentionally does not add work to live
ticks. Candidate grouping alone provides no claimed speedup.


`local_cylinder_contacts: true` is an experimental, opt-in numerical profile.
It reserves surface-vertex candidates on detected soft/cylinder pairs and refreshes
those vertex contacts inside the local solver substeps on the existing worker pool.
Manifold surface contacts retain their existing update path. Unrelated bodies keep their existing
solver cadence; this does not add whole-world contact passes. Omission/false
preserves the previous solver. Native capability `local-cylinder-contacts-v1`
is required before enabling it. The option is also accepted by `physics-batch`
and gameplay recipes, so candidate worlds and reports pin the choice.

This is not a general asynchronous collision scheduler. New body pairs still
come from the outer collision pass, and soft/mesh and rigid/rigid contacts retain
their existing paths. Candidate coverage and force behavior must be qualified
for each mechanism. An intake-only improvement does not qualify a match:
verify pickup, shooting, passive contacts and robot interactions before selecting
this profile for gameplay. It is disabled by default and not a recommended
match profile while that qualification is incomplete.
