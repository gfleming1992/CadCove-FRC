# Authoring the native physical world

Use this alongside `frc-cad-mechanisms`, `frc-ctre-controls`, the robot's
calibration ledger, and the exported `.cadcove/bridge/DEVICE-ADAPTERS.md`.
This describes the common rigid-body contract, not a complete JSON Schema or
an automatic CAD-to-mechanism compiler. Unknown JSON properties can be ignored
by native deserialization: successful loading does not prove a typo was applied.

`physics-world-example.json` beside this file is a synthetic bench mechanism:
a fixed support, two shafts, one idealized motor and a compliant reversing gear
coupling. Its arbitrary dimensions/material/electrical values are test data,
not a CTRE specification, robot recipe, or calibrated mechanism. It is only a
world file; it does not contain CAD assets, scene bindings or Java device setup.
Keep it separate from the team's real world.

## Files and frames

- `robot.sim.json` selects the compiled build directory, robot/field CAD roots,
  runtime paths and calibration ledger. Paths are relative to the manifest.
- `<build>/world.json` describes native bodies, colliders, joints and motors.
  The Java bridge also reads independent season, vision and device configuration.
- `<build>/scene-bindings.json` maps CAD occurrences to physical bodies and pins
  the exact world bytes and source revisions. Never fix a stale build by only
  replacing its recorded hashes.
- Mesh-file paths resolve under `runtime.assetRoot`, or the manifest directory
  when omitted. Keep paths relative, without `..`; escaping symlinks are rejected.

Physics uses metres, kilograms, seconds, radians, newtons and newton-metres.
CAD source/meshes use millimetres; convert once at the explicit boundary.
World +Z is up. Body `rotation` is a **scaled axis-angle vector**: unit axis
times angle in radians, not Euler angles or a quaternion. Initial velocities
are world-space m/s and rad/s. State output quaternions are `[x,y,z,w]`.

## World settings

`bodies` is required. Supply explicit `joints: []` and `motors: []` even for an
unpowered scene, because the project audit checks these lists. `transmissions`
and `compliance_zones` default to empty arrays. Current defaults:

| Setting | Default | Native constraint |
| --- | --- | --- |
| `dt` | 0.005 s | Greater than zero, at most 0.02 s |
| `gravity` | `[0,0,-9.80665]` | Three finite numbers |
| `contact_tolerance` | 0.0002 m | Greater than zero, at most 0.01 m |
| `solver_iterations` | 4 | Integer 1–32 |
| `static_contact_frequency_hz` | 60 | 10–1000 |
| `soft_contact_max_angle_rad` | 0.2 | 0.05–0.6 |

Do not tune numerical settings until units, shape placement and physical
parameters are correct. Reduced-order `gameplay` mechanisms, compliant contact
zones and experimental triangle-contact settings require their own reviewed
recipe and tests; they are not inferred from this rigid-body example. Declare
gameplay approximations and preserve the detailed source world separately.

## Bodies and collision geometry

Every body has a unique `id`, world-space `position: [x,y,z]`, and `colliders`.
The current viewer/gyro adapter requires a root body named `chassis`.

| Field | Meaning/default |
| --- | --- |
| `fixed` | `false`; use `true` for stationary field/support bodies |
| `rotation` | Scaled axis-angle, default `[0,0,0]` |
| `mass` | Positive kg; default 1, including a required positive value on fixed bodies |
| `velocity`, `angular_velocity` | Default zero; fixed bodies cannot start with motion |
| `friction` | Nonnegative, default 0.8 |
| `restitution` | 0–1, default 0 |
| `membership`, `filter` | 32-bit collision bitmasks, default all bits |
| `principal_inertia` | Optional three positive kg·m² values in the body's local axes |
| `center_of_mass` | Local metre offset; applied with explicit `principal_inertia` |

Without authored inertia, the engine derives mass distribution from the
colliders and scales it to `mass`. A body without colliders has a fallback
inertia, not inferred robot mass properties. Do not use that fallback as
evidence of fidelity. When simplifying collision geometry, supply reviewed
mass properties if the simplification would distort the actual inertia.

Supported shape examples (coordinates are local to the body):

```json
{"kind":"box","half":[0.1,0.2,0.03],"center":[0,0,0]}
{"kind":"ball","radius":0.05,"center":[0,0,0]}
{"kind":"cylinder","radius":0.04,"half_height":0.02,"center":[0,0,0],"rotation":[0,0,0]}
```

These are separate objects, not one JSON document. Box dimensions and cylinder
height are **half extents**. A cylinder's unrotated shaft is local Y. Box/ball
shapes do not accept their own rotation; rotate the body or use suitable mesh
geometry. Radius/half extents must be positive; poses must be finite.

An inline `mesh` has metre-space `vertices: [[x,y,z],...]`, indexed
`triangles: [[a,b,c],...]`, and `convex` (default false). Nonconvex moving
triangle meshes are rejected. A `mesh_file` has `file`, SHA-256 `sha256`,
optional local `position`/`rotation`, and either `convex` or explicit `cooking`:

| Cooking | Use |
| --- | --- |
| `tri_mesh` | Fixed concave field geometry |
| `convex_hull` | One convex moving component; fills all concavities |
| `convex_decomposition` | Approximate compound of convex pieces; inspect openings |
| `cuboid` | Validated rectangular solid, not its arbitrary bounding box |
| `cuboid_or_mesh` | Fixed geometry; falls back to triangle mesh |
| `planar_extrusion` | Explicit opt-in cooker with geometric preconditions; validate first |

Without `cooking`, `convex:true` selects `convex_hull`, otherwise `tri_mesh`.
Repeated mesh hashes share cooked shape data. Convex decomposition can populate
`build/physics-cache` under the asset root. Do not commit that derived cache.
Never turn a feeder opening into a filled hull just to reduce collision cost.

CTM1 is the collision-file format, distinct from the renderer's mesh format:
four ASCII bytes `CTM1`, little-endian uint32 vertex count, uint32 triangle
count, then three float32 metre coordinates per vertex and three uint32 indices
per triangle. Exact byte length is `12 + 12 * (vertices + triangles)`.
Hash the complete bytes. Indices must be in range; malformed, degenerate or
unsupported geometry can still fail cooking. Rendering tessellations are not
automatically valid collision artifacts.

## Joints and motors

Joint fields: unique `id`, `parent`, `child`, `kind` (`revolute`, `prismatic`
or `fixed`), `axis`, `anchor_parent`, `anchor_child`. Use a unit axis in the
parent's initial local frame. Anchors are metre offsets in each body's local
frame and must meet at the intended joint in the authored pose. The bodies
must differ. Never pass world-space anchors into these local fields.

Optional `limits: [low,high]` use radians for rotation or metres for translation.
`initial_position` defaults to zero and names the joint coordinate represented
by the CAD bind pose; it does not move the CAD into that pose. `damping` defaults
to zero and must be nonnegative. `contacts_enabled` defaults to false between
connected bodies, because shaft/bearing collision geometry commonly overlaps.
Enable it only for intentional physical stops with compatible collision groups.

A motor references a nonfixed joint by `joint` and a unique `id`. Required
electrical fields are `resistance` (ohms), `torque_constant` (N·m/A),
`velocity_constant` (rad/s per volt), `current_limit` (A), and `rotor_per_unit`.
Use positive electrical values from the actual motor/FOC mode. `efficiency`
defaults to 0.9 and must be in `(0,1]`; `initial_rotor_turns` defaults to zero.

`rotor_per_unit = d(rotor radians) / d(joint coordinate)`: rad/rad for a gear
reduction, rad/m for a drum, rack or screw. It is signed and nonzero. For a drum
with output radius `r` and reduction `G`, magnitude is `G/r`; do not multiply
by `2π` again. Feedback is
`rotor_turns = joint_position * rotor_per_unit / (2π) + initial_rotor_turns`.
Keep physical gearing, encoder offset and controller inversion distinct.
Real robot code supplies voltage through its actual registered motor objects;
do not drive the plant by copying requested motor positions into body poses.

`transmissions` couple two nonfixed joints without inventing another motor:
`id`, `driver`, `follower`, signed `ratio`, optional `phase` (default 0), positive
`stiffness`, nonnegative `damping`, and positive `max_effort`.
The constraint error is `q_follower - ratio*q_driver - phase`. Ratio is follower
units per driver unit; `max_effort` is follower N·m or N. This is a bounded
spring/damper coupling, not an infinitely rigid gearbox. Validate back-driving,
saturation, signs and end stops under load.

## Bind CAD without moving or double-scaling parts

`scene-bindings.json` includes `schema:1`, `worldHash` of exact world-file bytes,
`sourceHash`/`fieldSourceHash` matching each CAD `assembly.json`, `sourceInputs`,
`start` and `fieldOrigin` (metres), plus `robot` and `field` mapping objects.
Every robot occurrence must map to a real body. Use stable occurrence IDs, not
array offsets or temporary labels. Record every editable physical/CAD build
input in `sourceInputs: {schema:1,files:[{file,sha256},...]}` under the asset root.

Robot binding values are `{body,local}`. `local` is a row-major rigid 3×4 matrix
with translation at indices 3,7,11, in metres. At the authored bind pose:

`local = inverse(bodyWorldAtBind) * occurrenceWorldAtBind`

Convert the CAD occurrence translation from mm first and include `start` once
when deriving its world placement. The renderer later computes `bodyPose*local`.
Do not apply the occurrence placement again inside the mesh vertices.

For a moving field part, use `{body,local}` with the same rigid local-transform
formula. Include `fieldOrigin` once in the occurrence's bind-world placement.
This supports arbitrarily rotated field bodies. The older `{body,bindPosition}`
form remains available for translation-only body bind frames: `bindPosition`
is before adding `fieldOrigin`, and the viewer derives its local matrix from
that translation and the CAD occurrence. Select exactly one form. Static
unbound field parts retain their CAD placement plus `fieldOrigin`.

Both the CLI audit and viewers reject missing/nonfinite poses, non-rigid local
matrices (scale, shear or reflection), and ambiguous field bindings. CAD-to-metre
conversion belongs outside the rigid matrix's rotation block; a `0.001` scale
there is an error, not a valid body-relative transform.

## Verify before driving

1. Rebuild CAD/world/bindings from common source parameters and record hashes.
2. Run `cadcove audit --project robot.sim.json` for artifact consistency.
3. Run `cadcove sim-validate --project robot.sim.json` for native loading at tick
   zero. It executes the engine, may cook/cache shapes, and exits; no Java or
   robot session is started. Its bounded load check is not dynamic validation.
4. Build the actual team's robot program and test one actuator at a time in
   simulation: sign, travel, rotor feedback, coast/brake, limits and disable.
5. Inspect physical state and a mechanism-focused capture. Then test loaded
   contacts, coupled mechanisms and the complete course using that same JAR.

Season observers, optics/AprilTags, Phoenix mappings, gameplay approximations
and material calibration are separate contracts. Passing this example or
`sim-validate` does not validate those layers or establish real-robot fidelity.

## Custom force models

The bundled engine handles the world data above. For unsupported force behavior,
use a team-owned Rust executable registering the `mechanism::Mechanism` interface.
See `docs/CUSTOM-SIMULATOR.md` in the matching release and its
`examples/custom-mechanism` crate. Keep this separate from season scoring.
Select `runtime.customSimulator` in robot.sim.json and run `cadcove sim-build`
explicitly. Rebuild/restart after source changes; preserve calibration evidence.


## Numerical sweeps without a live session

For playability testing, 50 Hz (`dt: 0.02`) is an available candidate; determine
its suitability with actual driving, contacts and ball handling. It is not a
universal physics accuracy requirement. A world can opt into
`solver_schedule: "per_tick"` and `max_contact_substeps` (1–64) to budget global
contact refreshes. Fewer refreshes can miss or distort fast contacts. Defaults
remain motion-driven; local solver refinement and CCD still run.

Use `cadcove physics-batch --world WORLD_JSON --input PLAN_JSON --output NEW_REPORT`
to run isolated unpaced native trials. The plan contains `profiles` with `id` and
`settings`, `segments` with `seconds` and motor `volts`, and optional `checks`
(`maxLinearSpeed`, final `positions` ranges by body/axis, and final `joints`
ranges). Each profile resets source state. Set a smaller `dt` and
`max_contact_substeps: null` for finer offline checks; this removes the cap without
relabeling gameplay approximations as detailed physics. The CLI is suitable for
an exported subsystem world. It does not run WPILib code or change a live world.

The editor MCP tools `physics_batch_start`, `physics_batch_status`, and
`physics_batch_cancel` expose these trials as background jobs. Start with a plan,
then poll the returned job ID. Optional `worldFile` selects a workspace-relative
native subsystem world instead of the configured simulation world. Reports retain
numerical settings, source/binary hashes and caller-defined acceptance outcomes.
No explicit checks means `accepted: null`. A successful trial is not hardware
sign-off; use full robot-code tests and calibration for that purpose.

### Subsystem boundaries and dependency completeness

Subsystem selection is an authored graph overlay, not a prefix filter on body names. Use the schema and resolver in `.cadcove/skills/references/subsystems.md` (source: `docs/SUBSYSTEMS.md`): CAD hierarchy, body ownership, joint graph, cross-branch transmissions, stationary support geometry, material requirements and fixed/external test boundaries remain distinct. Declare expected missing feeder shafts, joints and motors explicitly; do not hide them by leaving their geometry attached to chassis. An isolated view must retain the surrounding guides, supports, drive motors and belt/gear dependencies needed to explain and test the mechanism.

Resolve membership first, compile the resulting complete physical graph with explicit restraints, then run native load/stepping/contact checks. A subsystem completeness report checks declared data presence, not solver validity, successful transport or hardware safety. Use actual material records, preserve estimated/unknown provenance and report exclusions or external dependencies. Do not silently fix a free pivot, remove a guide, alter foam dimensions or teleport a ball to obtain a passing feed test; authored test fixtures may lock a pivot or seed an approach only when that assumption is disclosed. Keep rendering, playback, contact test execution and offline sign-off separate actions.


### Recorded compression in the unified canvas

Use `canvas` action `replay` with a workspace `replayFile` to load authoritative
particle recordings paused, then explicitly play, pause, seek or unload. Follow
`.cadcove/skills/references/physics-replay.md` (source: `docs/PHYSICS-REPLAY.md`). Preserve the native acceptance result and contact
evidence; slow playback never converts a failed feed into a passing shot. Resolve
all presentation hardware from the subsystem definition, not just collision
bodies. GPU compute interpolates vertices and normals, but ingestion and uploads
still have CPU cost. Captures show the deformed GPU surface; CPU picking and mesh
export use the initial surface and cannot measure compression. Source/physics
edits rebuild asynchronously and reset the whole simulation stopped while
preserving camera, selection and isolation. Do not migrate live velocities across
changed colliders, mass or joints.

### Source-pinned concave mesh contacts

A moving concave guide must not be replaced by one filled convex hull. The shared physical model supports `mesh_file` colliders with an explicit workspace-relative `.ctm` path, SHA-256 pin, body-local metre coordinates, rotation vector and cooking mode. Legacy mechanism entries use `centerMm` / `rotationRad`; SI shapes use `center` / `rotation`; native export uses `position` / `rotation`. Set `cooking: "convex_decomposition"` for a reviewed moving concave approximation. Decomposition is not exact source-surface contact: compare clearance/contact probes against the triangle reference before claiming a guide works. Moving `trimesh` and `cuboid_or_mesh` are rejected.

Collider CTM1 vertices are metres, independently of the legacy model’s millimetre source. Assets must resolve inside the workspace, retain matching hashes and pass format/index checks; symlink escapes fail. Set legacy `physics.source` to `{kind:"cadquery", sha256: CAD_SOURCE_REVISION, entities:[SOURCE_OCCURRENCE_IDS]}` when geometry-derived bodies must be invalidated by a changed CAD revision. The canvas checks this source pin before preparation. Background preparation resolves assets from the workspace and runs an isolated construction/stepping check; it does not certify decomposition fidelity or calibrated foam contacts. Asset changes invalidate preparation. A physical-only mesh body needs explicit CAD visual geometry for the canvas; an empty or fabricated collision preview is not substituted.

### Explicit selective sphere compliance

Compliance is opt-in solver data, never inferred from a label such as foam. An SI body may declare `compliance: {frequencyHz, subdivisions, entryMargin, exitMargin, recoveryTolerance}`; all fields are required. Frequency is positive and at most300Hz; subdivisions is integer0,1or2; margins/tolerance are positive native-representable SI distances; exitMargin exceeds entryMargin and recoveryTolerance is less than5%of the sphere radius. The model also requires explicit `complianceZones: [{body, center, half, lookahead}]`, in body-local metres/seconds. Zone bodies must be rigid, half-extents positive, and lookahead between0.005and0.2seconds. Zones describe where this approximation may activate, not proof of compression fidelity.

A compliant body must be dynamic, own no joints and have exactly one centered spherical collider. Its authored center of mass must be zero and inertia must match a homogeneous sphere, `I=2/5*m*r^2`, with zero cross terms. The compiler verifies this assumption before omitting native inertia overrides; it does not discard incompatible measured inertia. Material and compliance calibration remain explicit provenance responsibilities.

Legacy `mm-deg` mechanisms can declare an independent game piece using body `free:true, fixed:false` with no joints. A free body stays at its authored CAD pose until physics runs; it is not attached to a robot by a fabricated joint. Legacy compliance lives under `physics.compliance` with the same SI parameter fields; top-level `complianceZones` remains SI despite CAD geometry using millimetres. A legacy ball collider uses `radiusMm` and `centerMm`. The rest of the rotary hierarchy is unchanged, and free/fixed or free/joint conflicts fail validation.

Activation zones create explicit physics dependency edges to compliant spheres, even if their contact masks differ, so background validation cannot split an activation frame away from its sphere. Rendering membership stays independent: no subsystem silently acquires a free ball merely because it is nearby. Removing the opt-in compliance declaration leaves an ordinary rigid sphere. Particle rendering and transport must be explicitly enabled separately; these parameters alone do not enable a live demo or feed a ball.
