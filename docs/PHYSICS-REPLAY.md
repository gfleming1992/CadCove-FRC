# Recorded physics and GPU deformation

The native solver owns contact, compression, motors and particle positions. The
viewer consumes recorded authoritative samples. Its WebGPU compute pass
interpolates surface vertices and calculates normals; it never solves a second
physics world. Small CPU costs remain for frame validation, upload, rigid-part
transforms and command submission. This is not zero-cost CPU rendering.

## Agent workflow

1. Resolve the complete subsystem from `config/subsystems.json`, including
   feeder rollers, motors, belts, pulleys and stationary supports. Inspect missing
   physics requirements before describing the setup as ready.
2. Generate an offline native test with declared material evidence and estimates.
   Keep the full ball path, contact witnesses, controller inputs and acceptance
   criteria. Do not replace a failed exit with an invented launch trajectory.
3. Return the recording to the agent for inspection. Loading and playback are
   separate commands; loading defaults to paused. Respect a user's request not
   to feed or start their live scene.
4. Load through `canvas_command` with `action: "replay"` and options
   `{ "action": "load", "replayFile": "build/test/replay.json" }`.
   The file must be inside the workspace and no larger than 32 MiB.
5. Use replay options `{ "action": "play", "speed": 0.1 }`,
   `{ "action": "pause" }`, `{ "action": "seek", "seconds": 0.25 }`,
   `{ "action": "state" }`, or `{ "action": "unload" }` as appropriate.
   `stop` pauses at the current recorded time. Seek also pauses. Speed changes
   affect playback only. `unload` restores the preceding CAD pose and isolation.

Recorded playback cannot command live motors, change placement or start live
physics. Return to CAD/unload first. A CAD/model invalidation unloads the recording.
Camera and existing occurrence identities survive replay, while loading adds a
unique ball mesh. During playback, GPU buffers remain allocated in place.

## Recording contract

Schema 1 requires SI units, the exact current `sourceRevision`, surface topology,
CAD occurrence-to-body `bindings`, and at least two monotonically timed frames.
Each frame has body position/quaternion and all ball particle positions. A native
triangle tuple list is normalized once into flat indices. Every surface vertex
must belong to a triangle; all frames must have the declared particle count.
Bindings include a local transform from authored CAD coordinates to body space.
Simulation metres are converted to CAD millimetres only in the presentation layer.

Keep `acceptance`, source/world/mechanism hashes, settings, material assumptions
and contact evidence with the record. `acceptance.passed: false` remains visible
in replay status. A separately audited `presentationDemoPassed: true` with
`physicalPredictionQualified: false` is labeled as an illustrative feed with
unqualified prediction; it does not overwrite a failed legacy gate. A recording is historical evidence, not qualification of later
material or mechanism edits. The current viewer checks CAD revision; consumers
must also compare mechanism/world provenance before claiming current readiness.

## Rendering limits and verification

Particle arrays are immutable and cached; new frames upload once per buffer use.
The compute shader writes a private buffer and copies only the ball's vertex
slice into the existing scene buffer. CAD mesh caches are untouched. Captures
draw the same deformed GPU surface seen on screen. CPU picking and mesh export
still use the initial ball mesh and must not measure compressed geometry.

This path currently plays fixed-topology recordings, not a live deformable-body
network stream. The mesh is a presentation of the solver's discretization, so a
coarse particle surface remains visibly coarse. It does not add unmeasured foam
detail. Synthetic GPU timing is neither full-scene FPS nor contact validation.
Use real subsystem recordings and screenshots to verify compression and measure
render cost separately from native simulation cost.
