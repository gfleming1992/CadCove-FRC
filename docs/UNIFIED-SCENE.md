# Persistent CAD scene and background physics

The CAD webview owns camera, selection and geometry for its lifetime. Product
services attach native physics and a managed WPILib simulation to that viewport.
`Open Mechanism Preview` is a compatibility alias for the editable CAD scene;
`Open Live Simulation` attaches to the open robot scene. Neither creates a second
simulation canvas. Generic hooks live in the separately committed/pinned CAD core.

## Background preparation

After a successful CAD build, the host reads the checked mesh cache and the
adjacent `mechanism.json`. The optional `physical` member is the canonical SI
physical graph. Existing schema-1 rotary definitions normalize through the
existing exporter. Geometry keys participate in component revision hashes.

The scene coordinator derives dependency components from joints, transmissions
and every collision pair permitted by the authored masks. A shared fixed fixture
is a dependency too. Independence is conservative: two assemblies that can
collide never run in separate worlds. Separate collision groups with no joints
or transmissions can continue independently.

A pool allows two background preparation jobs at once. Each job constructs and
steps an isolated native process; CAD, camera and editor requests remain usable.
The generic host explicitly dispatches scene-service requests outside its serial
CAD build queue. Superseding an edit cancels queued work and kills its candidate
process. Completion callbacks check their generation before activation.

States: outdated → building → validating → awaiting-activation → ready, or failed.
The candidate is stepped for 20 ticks with zero motor inputs, checked for finite
state/body coverage, then reloaded at the authored initial state. Native failures
revoke readiness. These checks establish loadability and bounded smoke-test
success for the declared parameters, not real-world calibration or collision
accuracy of an approximation.

Physics edits reset the complete simulation to its authored initial state with
motors stopped. No velocities, contact caches or controller state migrate across
a changed definition. All candidate components build and validate asynchronously;
CAD stays visible, with camera, selection and isolation preserved. Activation
publishes the reset state only when every component is ready. Starting physics
or commanding motors requires an explicit request after that reset. The
coordinator reports `resetPolicy: "whole-scene-stopped"`. An unchanged status query
does not reset a running scene. Superseded candidates cannot activate.

`canvas_command` includes `physics-status` and `physics-wait` (`after` sequence,
`timeoutMs` up to 25000). Events carry job ID, bodies, physics revision, status,
checks and state-transfer policy. A dependent physics request returns
`{ok:false,pending:true,blocked:[...]}` while preparation is outstanding. Failed
validation returns pending:false with the failure. Waits release the event loop;
they do not block CAD builds or other concurrent MCP requests. The event log is
bounded and reports truncation so clients can reconcile using current status.

## Physical description

The richer contract follows the separation in
[SDFormat 1.12 links](https://sdformat.org/spec/1.12/link/),
[joints](https://sdformat.org/spec/1.12/joint/), and
[collision](https://sdformat.org/spec/1.12/collision/). It is a supported JSON
subset, not an SDF XML importer or a claim of full SDF conformance.

- Explicit SI `m-kg-s-rad` units.
- Stable body IDs and CAD occurrence ownership; source kind/hash/entity references.
- Optional `cadFrame` (SI position and rotation vector) binds authored CAD geometry
  independently of the initial body pose; it defaults to that pose.
- Authored mass, COM and full symmetric inertia tensor about COM in body axes.
- Box, ball and cylinder shapes; hash-pinned CTM mesh colliders with explicit cooking, local frames and workspace asset roots; friction, restitution and masks. Dynamic meshes require a convex cooking mode, and physical-only meshes require explicit CAD visual geometry. Convex decomposition is an approximation, not proof of channel clearance.
- Fixed, revolute and prismatic joints with body-local anchors, parent-frame axis,
  limits, initial coordinate, damping and linked-body contact policy.
- Transmission ratio, phase, stiffness, damping and effort bound; motor electrical
  parameters and joint bindings. Free bodies and closed physical joint loops.
- Per-body provenance (derived/measured/reviewed/estimated plus evidence).

Unknown fields fail validation. Inertia must be positive definite and satisfy
mass-distribution inequalities. CAD motion's legacy revolute tree remains useful
for scripted animation; it is not mistaken for the complete physical graph.
Physical-only game elements use collider previews in the same canvas. Field CAD
is visual context until explicit physical bodies are supplied.

CadQuery and imported STEP solids can use
`physical_properties.mass_properties(shape, density_kg_m3, evidence)` to derive
mass/COM/full inertia from explicit homogeneous density. This is an opt-in exact
geometry calculation and can run in a preparation worker; the viewport does not
infer density or add it to every mesh build. Its analytic-box test checks SI units.

STEP inspection preserves raw representation frames, limits, source-scoped
entity references and dependency edges. It explicitly lists missing physical
properties. Representation units and occurrence mappings must be resolved before
turning the report into a simulation model. Existing `sourceStep` pins prevent
using a projection after its STEP source changes. This retains the boundary
between exchange metadata and an executable physical model.

## Authoring and agent use

Keep `mechanism.json` beside the CadQuery or STEP entry. Legacy top-level bodies,
joints and relations still drive CAD animation. Add `physical` to use the richer
physical graph instead of deriving it from those legacy fields. The `parts` IDs
must match the exact exported CAD occurrences; every CAD part needs one physical
owner. A body with `parts: []` is a physical-only object and gets collider visuals.
CadQuery shape attributes and raw STEP entity references alone do not constitute
an executable physical definition.

For example, a CAD occurrence named `part` can be paired with this minimal
physical sidecar. These are illustrative declared values, not material estimates
that the application applies automatically:

```json
{
  "physical": {
    "schema": 1,
    "units": "m-kg-s-rad",
    "gravity": [0, 0, -9.80665],
    "bodies": [{
      "id": "part-body", "parts": ["part"], "fixed": false,
      "position": [0, 0, 0.2], "rotation": [0, 0, 0],
      "cadFrame": {"position": [0, 0, 0], "rotation": [0, 0, 0]},
      "inertial": {
        "mass": 1, "center": [0, 0, 0],
        "tensor": [0.001, 0.001, 0.001, 0, 0, 0]
      },
      "collision": {
        "friction": 0.4, "restitution": 0.1,
        "shapes": [{"kind": "box", "half": [0.025, 0.025, 0.025], "center": [0, 0, 0]}]
      },
      "provenance": {"status": "estimated", "evidence": "Illustrative test body"}
    }],
    "joints": []
  }
}
```

An orchestrator can call `canvas_command` with `action: "physics"` and
`options: {"ids": ["part-body"]}`. If the response is pending, keep using CAD, and call `physics-wait` with the last `sequence`.
Reconcile with the returned component revisions before retrying. A ready event
includes the validation checks and provenance; it does not start motors. Use
`motors` only after starting the corresponding physics component. Avoid assigning
separate collision groups solely for speed: doing so changes which objects can
interact physically.

## Managed robot simulation

A managed WPILib run remains owned by its existing Java/native bridge. The same
canvas attaches to its revision-checked world and supports capture, camera follow,
body visibility and pose interpolation. Attachment binds existing CAD occurrences
in place: it does not fetch a second robot assembly, replace occurrence IDs, or
re-upload geometry buffers. Field geometry uses the shared scene's cached field
loader. Native CAD's baked occurrence frames are removed from the physics bindings;
imported prototype-local meshes retain their original bindings. Missing occurrences,
invalid frames and changed CAD revisions reject attachment. Returning to CAD restores
the pre-simulation transforms and opacity without replacing the assembly. Background
physics preparation and its validation ticks remain enabled.

Source invalidation stops presenting its
old poses as current. Changing its compiled world requires rebuilding the project
artifacts and restarting that managed run; background component replacement is
currently provided for the scene's direct native physical graph, not live Java
controller/sensor state migration. Closing a view does not silently stop an
independently owned robot program.

## Solver and packaging migration

Rapier is the sole mate backend. Shared request validation and independent
residual checks moved to generic `mate_contract.py`. Ondsel's native bridge,
build scripts, optional CLI selection, package assets and tests were removed.
Core changes are committed upstream and re-exported through the hash pin.
The separate mechanism renderer and simulation renderer were retired after moving
their rendering duties into `web/scene-extension.js`.

Checks: portable toolbox suite; native construction/step/cancellation tests;
Rapier mate regression; analytic mass properties; native Rust tests; browser
WebGPU camera/selection, game-piece and stale-readiness regression. Platform VSIX
qualification is separate from a successful local bundle or package build.

## Shared subsystem definitions and recorded deformation

[Subsystem definitions](SUBSYSTEMS.md) select the same stable occurrences from
STEP, CadQuery or mixed trees for isolation and mechanical dependency checks.
They include stationary supports and connections across assembly branches.
Declared-data completeness is separate from native contact-test qualification.

[Recorded physics playback](PHYSICS-REPLAY.md) presents authoritative particle
frames through WebGPU compute in this same canvas. Playback can pause, seek or
slow down without changing the recorded physics. Failed feed recordings remain
failed regardless of presentation speed.
