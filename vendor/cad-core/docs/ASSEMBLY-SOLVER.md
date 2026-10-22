# Headless assembly solver (experimental)

## Inspect standard STEP kinematics

`python src/native/step_kinematics.py --input assembly.step --output new-report.json`
uses OCCT's ordinary STEP reader and typed `OCP.StepKinematics` entities. This
requires an explicitly configured OCP build exposing that module; stock OCP
installations without it return an actionable failure. It does not parse STEP
text itself or replace the geometry importer.

The report preserves link references, revolute/slider frames and limits,
authored coordinates, gear parameters, and link-representation references.
Unsupported entities are listed, never silently converted. IDs identify decoded
model entities within the reported file SHA-256, not stable CAD occurrences or
necessarily the original textual STEP labels. Duplicate names remain distinct.
An ordinary geometry-only STEP returns `hasKinematics:false`.

This is metadata inspection, **not an automatic STEP-to-Ondsel converter**.
Coordinates and limits remain in their raw representation units. Unit/context
resolution, mapping links to geometry occurrences, and complete constraint
coverage must be established before producing a solver request. Until then the
report explicitly says `solverReady:false`; the viewer and physics cannot treat
it as an imported mechanism.

CadCove can call the unmodified OndselSolver library used by FreeCAD, without
FreeCAD's GUI, document classes, Qt, OCCT, or a geometry rebuild in that process.
A small MIT bridge dynamically links the LGPL library. Python validates requests
and independently checks solved mate/driver residuals. The library is an optional,
explicitly installed dependency; it is not included in the current VSIX runtime.

This first adapter handles **fixed, revolute and slider** mates, including closed
loops. Drive a coordinate with explicit initial position, velocity, acceleration
and jerk over a finite duration. Gear, belt and chain ratios between parallel
shafts on a common carrier use native Ondsel gear constraints. It returns sampled
rigid-body poses. It does
not infer mates, certify mobility, enforce travel limits, perform interference checks, or run contact physics. Unsupported
fields/types fail rather than silently disappearing. The existing rotary-tree
animator and physics exporter still handle their own supported contracts.

## Build and use

Requires Python 3, Git, CMake and a C++17 toolchain. Run explicitly:

```sh
python3 src/native/ondsel/build.py --output /absolute/new/build-directory
export CADCOVE_MATE_SOLVER=/absolute/new/build-directory/bridge/cadcove-ondsel
python3 src/native/ondsel/solver.py --input request.json --output new-solution.json
```

The toolbox exposes the same operation as:

```sh
cadcove cad-mates --action capabilities
cadcove cad-mates --action solve --input request.json --output new-solution.json
```

No CAD source execution or mesh generation occurs. Output refuses overwrite.
Use `CADCOVE_PYTHON`/`--python` for the CLI interpreter and `--solver` to override
the executable. Capabilities reports configured, **not** installed/working.
Python callers can import `solve(request, executable=...)` from `solver.py`.
The subprocess isolates crashes, sets a 60-second timeout and captures native
logs. Failed or incomplete runs produce no usable solution. No background daemon
or automatic dependency download starts when opening a CAD model.

Source and shared library are pinned by `src/native/ondsel/upstream.json`.
`build.py` leaves the exact source, license and build provenance beside the
executable. The development build path is macOS/Linux; Windows packaging and
all release/platform qualification remain pending. Only macOS arm64 has been
exercised locally. Do not ship this developer build as a qualified release.

## Agent request contract

`schema:1`, `units:"mm-deg-s"`, `bodies`, `mates`, `drives`, `duration`,
`samplePeriod`, optional `sourceRevision`, `couplings`, `jointBindings`. This is a transient solver adapter
request, not a competing authoritative mechanism or interchange format.

- Body: unique `id`, `pose` (16-number column-major initial world transform), optional
  `fixed:true`, optional `parts` (stable CAD occurrence IDs, required to display).
  Optional `bindPose` is the CAD geometry's original placement for rendering when
  the solver starts from a different posed configuration; both transforms must be rigid.
- Mate: unique `id`, `type`, `a:{body,frame}`, `b:{body,frame}`. Both frames are
  body-local rigid transforms. Their Z axis defines hinge/slide travel. Fixed
  mates align the frames; revolute mates permit relative rotation about Z;
  slider mates permit relative translation along Z.
- Drive: `joint` mate ID and optional `position`, `velocity`, `acceleration`,
  `jerk` (zero defaults). Revolute units are deg, deg/s, deg/s², deg/s³; slider
  units are mm, mm/s, mm/s², mm/s³. Coordinate is B relative to A, not a delta
  from the CAD bind pose. Polynomial: p + v*t + a*t²/2 + j*t³/6.
- Timing: seconds, 0–300 duration, positive samplePeriod ≤1s; duration must be
  a whole number of sample periods. At most 10,001 frames and 100,000 body poses.
  A zero duration requests a single solved placement.

At least one body must be grounded; every body must connect to a grounded
component. Initial placements seed the assembly branch. Multiple assembly
branches and singularities are possible: convergence does not establish the
intended physical branch. The independent checks verify frame rigidity, grounded
poses, positional/orientation mate residuals and commanded coordinates at
returned samples. `collisionChecked:false` and `mobilityCertified:false` are
intentional; these checks do not establish physical feasibility.

When deriving a request from imported STEP, use only authored or reviewed joints.
Keep the evidence ledger and stable references in the model; don't promote
coaxial candidates to active joints automatically. The four-bar test drives only
one hinge; no follower trajectory is supplied. Its dependent positions are
compared with an independently calculated parallelogram solution. Slider tests
check acceleration and jerk; conflicting grounded/driven motion must fail.

## Gear and pulley couplings

Add `couplings` to the request, referencing revolute mate IDs:

```json
{"couplings":[{"id":"stage1","type":"gear","driver":"input",
"follower":"output","driverTeeth":20,"followerTeeth":40,"direction":-1}]}
```

The follower moves at `direction * driverTeeth / followerTeeth` relative to the
common carrier. Direction is explicit (+1 or -1); external meshing gears usually
use -1, open belts +1. Both mate A frames must be on the same carrier with
parallel, equally oriented Z axes. Compound stages can share a shaft. Only the
root gets a drive; driven followers, duplicate followers, cycles and unsupported
axis layouts fail. Initial body poses establish the coupling phase.

The native bridge creates `ASMTGearJoint` constraints, with signed radius ratios
for same-direction belt/chain coupling. It does not script follower trajectories.
The Python adapter independently checks every returned follower pose against the
ratio and propagates full-turn branches from the driven root. This models ideal
kinematics, not tooth contact, belt tension, backlash or slip. Tooth counts specify
the ratio; shaft placement remains explicit and is not inferred from mesh shape.

## Display solved motion

### Existing reviewed mechanism trees

`cadcove cad-mates --action solve-mechanism --input REQUEST.json --output NEW_SOLUTION.json`
accepts `{mechanism, motion, sourceRevision}`. `mechanism` is the existing schema-1
mm-deg definition; `motion` contains `duration`, `samplePeriod` and polynomial
`drives` with joint/part/motor targets and position/velocity/acceleration/jerk.
Positions use the mechanism's absolute angle convention. Uncommanded independent
joints hold their bind angles. Follower targets resolve back through tooth ratios;
conflicting commands to the same coupled chain fail. Joint travel is checked at
polynomial extrema, not just samples, including coupled followers.

The generic adapter preserves body origins, tilted axes, bind angles and
transmission phases. It emits native constraints and continuous belt bindings;
it seeds the initial pose from the tree and resets solver coordinates to zero at
that pose, retaining original CAD bind transforms and absolute visual angles.
This avoids asking the solver to assemble many full turns away from its seed.
no CAD geometry is rebuilt. Only equally oriented parallel shafts on a common
carrier are supported for gear/belt/chain coupling. This conversion does not
infer missing linkage, contact or one-way deployment behavior. The input must
already be an adequate mechanism model. The resulting solution uses the same
`play-solved` path below in both canvases.

Both canvas dispatchers accept motion action `play-solved` with `solution` set to
the full returned JSON. Include the **current CAD source revision** in the solve
request; playback rejects stale/missing revisions and unknown/multiply owned
occurrence IDs. Command envelope for the toolbox:

```json
{"action":"play-solved","solution":{"schema":1,"sourceRevision":"..."}}
```

The abbreviated solution above must be replaced with the actual full solve
result. Use `cadcove canvas --target cad|field --action motion --input command.json`.
Existing pause/resume/seek/stop/reset commands also work. Reset restores the CAD
bind pose; reset before switching back to the rotary-tree animator. The viewer
applies `solvedWorldPose * inverse(bindWorldPose)` to existing meshes, on its
local clock, without rebuilding geometry. Field placement remains outside those
transforms. Solved samples are held, not independently interpolated: interpolation
could break closed-loop constraints. Choose a sufficiently fine sample interval
(e.g. 1/60s) for smooth playback. Solver sampling is not continuous collision
coverage. Existing belt teeth can follow solved pulley rotation through explicit
`jointBindings` on the solve request:

```json
{"jointBindings":[{"joint":"pulley-axis","mate":"pulley-mate","scale":1,"offsetDeg":0}]}
```

`joint` names the loaded mechanism joint; `mate` names a driven or ratio-coupled
revolute mate. `scale` is an axis sign (+1 or -1); `offsetDeg` converts the mate's
absolute coordinate to the mechanism's angle convention. Mate A must own the
carrier parts and B the pulley parts. The adapter verifies the actual pose and
uses the prescribed root drive and verified coupling ratios to retain full turns, emitting continuous per-frame
`angles`. Uncoupled passive joint turn counts are not inferred from sparse poses: such
bindings fail explicitly. Belt deformation remains visual; the pulley ratio is
a native solver constraint when authored in `couplings`.

Load the existing mechanism and its belt surfaces before `play-solved`. Missing
bindings for affected belts, stale revisions and mismatched body ownership fail
before replacing playback. Both canvases deform the cached belt surface from the
held solver sample and apply its carrier transform once. Seek, reverse, pause,
resume and reset use the same path; no CAD rebuild is required.

## Reuse boundaries found in FreeCAD

- **Ondsel assembly solving:** directly reusable standalone C++ library. FreeCAD
  converts document bodies, local connectors, mates and prescribed motion to its
  API. Our Python/CLI layer supplies those inputs without the document GUI.
- **FreeCAD Assembly App layer:** also has a headless build boundary, but depends
  on FreeCADApp, Part, placement/reference/document infrastructure. Its convenient
  Python command scripts often import FreeCADGui. Removing buttons is not enough
  to transplant those scripts into stock CadQuery.
- **Sketch constraints (PlaneGCS):** another possible reuse target. It is embedded
  in Sketcher today, whose CMake target links Part and FreeCADApp. Evaluate a
  narrow extraction/binding or a headless FreeCAD backend separately; no claim
  that it is currently installed or a standalone Python dependency.
- **Persistent face/edge names, attachment, recompute, transactions:** useful but
  bound to FreeCAD's document/shape history. Adopting that backend is a larger
  design choice than this solver bridge. Keep our stable occurrence IDs and disk
  geometry cache meanwhile. OCCT algorithms themselves already come via OCP.
- **Physics:** do not equate the library's multibody naming or `DYNAMIC` output
  label with proven contact simulation. In this pinned source, the inspected
  `runBasicCollision` and `runCollisionDerivativeIC` functions are empty. The
  tested path is `runKINEMATIC`. Keep native Rapier contacts, motors, and robot
  integration; export supported common joints with explicit physical properties.
  Closed-loop solver output alone does not extend the current physics exporter.

Sources reviewed: [FreeCAD Assembly implementation](https://github.com/FreeCAD/FreeCAD/blob/1.1.4/src/Mod/Assembly/App/AssemblyObject.cpp),
[Assembly build boundaries](https://github.com/FreeCAD/FreeCAD/blob/1.1.4/src/Mod/Assembly/CMakeLists.txt),
[Sketcher build](https://github.com/FreeCAD/FreeCAD/blob/1.1.4/src/Mod/Sketcher/App/CMakeLists.txt),
[Ondsel pinned source](https://github.com/FreeCAD/OndselSolver/tree/4be80eef02a3486cda0d78f3ccbb308d207a9639).

## License and packaging boundary

Ondsel retains LGPL 2.1 (`LICENSE.Ondsel`); our new bridge/adapter is MIT. The
library source is unmodified. Dynamic linking does not eliminate LGPL duties:
distribution must include notices/license, corresponding library source access,
and permit an interface-compatible replacement library and the relevant
modification/reverse-engineering rights. LGPL does not generally require all
independent application source to be public solely for this linkage. Verify the
actual release artifacts and terms before distribution. No claim of legal or
platform certification follows from a local build. This bridge does not import
FreeCAD's other code or inherit a blanket license for future reused modules.
