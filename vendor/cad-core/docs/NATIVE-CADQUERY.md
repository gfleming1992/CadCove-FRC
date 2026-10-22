# Native CadQuery in the editor

The VS Code host can open `.py` models using a persistent local Python process,
CadQuery 2.6.1 and OCP 7.8.1.1. The WebGPU viewer, camera controls, mesh format,
revision checks and last-good-scene behavior are shared with JavaScript models.
This backend is optional during migration. The static website still runs
JavaScript/brepjs in its browser worker; it cannot execute native Python.

## Setup

Use Python 3.12 and a dedicated virtual environment:

```sh
python3.12 -m venv .venv-cadquery
.venv-cadquery/bin/python -m pip install -r src/native/requirements.txt
```

On Windows, use `py -3.12 -m venv .venv-cadquery` and
`.venv-cadquery\Scripts\python.exe` for subsequent commands. Set the VS Code
`instantcad.pythonPath` setting to the **absolute executable path**. The
extension ships the worker and requirements, not Python or its binary packages.
Dependencies are installed explicitly; opening CAD never installs software.
Native operations have a bounded 15-minute deadline on Windows for cold, full
assemblies (five minutes elsewhere). A timeout reports that cause explicitly
and a subsequent request starts a fresh worker; explicit caller budgets still
apply. These limits are not performance guarantees.
Only macOS arm64 execution has been tested so far.

Set `instantcad.entryPoint` to `model.py` (or right-click a `.py` file and choose
Open in CAD Canvas). Existing source/build-directory settings also apply.
Python models have separate cache directories from same-named JavaScript models.

## Authoring

```python
import cadquery as cq

def build(ctx):
    bracket = ctx.component(
        "bracket",
        lambda: cq.Workplane("XY").box(80, 40, 6)
                  .faces(">Z").workplane().hole(8),
    )
    return [{"id": "bracket", "name": "Mount", "color": "#e64b36",
             "shape": bracket}]
```

`build(ctx)` may return a Shape, Workplane, CadQuery Assembly, or a list of part
records. Stable IDs identify parts across edits; units are millimetres, Z-up.
Use ordinary Python imports and the full CadQuery/OCP APIs. The native Inspect
dialog accepts Python with `cq`, `parts` and `ctx`; assign JSON-compatible output
to `result`. `parts` contains the last successful exact shapes.

`ctx.import_step(relative_path, sha256=None)` imports a STEP under the configured
CAD source folder; `ctx.read_asset` reads other inputs. An optional SHA-256 must
match. Native source revisions track `.py`, `.json`, `.step`, `.stp` and `.brep`
files in that folder (excluding the build directory and hidden directories).
Other generated/external dependencies are not tracked: put authored numeric data
in Python/JSON, and do not depend on environment/time/network for deterministic
cached builds. On Windows, source bytes are re-read rather than trusting a
timestamp-only digest cache: rapid same-size edits can retain identical file
metadata. This preserves geometry and mesh cache reuse by content hash.
STEP hashing cost is part of source scanning; a large source pack
still needs profiling before switching its default backend.

`ctx.component(name, factory, dependencies=None, inputs=None)` caches exact
geometry and meshes in the warm process and on disk beside the scene cache. By default every tracked source is a
dependency. Narrow that list only when it includes **all transitive source and
asset dependencies**, and put changing arguments in `inputs`. For example:

```python
shape = ctx.component("rail", lambda: make_rail(length),
    dependencies=["parts/rail.py", "parts/common.py"], inputs={"length": length})
```

The cache returns copies and checks BREP signatures before reusing meshes, so
mutating a returned shape cannot corrupt the canonical component cache. Failed
builds do not replace the accepted scene. Unused memory entries are dropped after
successful builds, with a 640 MiB accounting cap based on BREP/mesh sizes. This
is **not** an RSS limit: OCCT, Python and the accepted scene also consume memory.

The per-entry `components/` directory retains exact BREP, tessellations and
measurements across worker/editor restarts. Each key includes the runtime,
component name, dependency hashes and inputs. The file checksum covers metadata
and geometry; invalid, missing or obsolete files are rebuilt from source.
Writes are atomic, individual entries are capped at 256 MiB, and disk storage
is pruned to 2 GiB per entry. Deleting this generated directory is safe; the next
edit rebuilds its missing components. No pickle or executable cache is used.
`timings.components.diskHits` distinguishes disk reuse from warm-memory hits.
A runtime upgrade needs one rebuild to populate the new runtime's cache.

## Runtime and trust

Python runs with the user's local permissions, like a project build tool. This
is not a sandbox for untrusted generated code. VS Code workspace trust is
required. Builds are serialized per model, bounded by a five-minute timeout,
and cancellation/closing the panel terminates its worker. Opening a valid cached
scene starts no Python process. Hot swaps keep the current camera and reuse
unchanged GPU batches.

Source revision identity includes the pinned CAD versions and the worker file's
SHA-256. Updating worker behavior invalidates previous mesh caches. Binary scene
validation and scene SHA-256 checks remain enabled. A changed file during a build
prevents accepting that result.

## Verification

```sh
CADCOVE_PYTHON="$PWD/.venv-cadquery/bin/python" bun test tests/native-cad.test.js
bun run build:vscode
CADCOVE_PYTHON="$PWD/.venv-cadquery/bin/python" bun scripts/test-vscode.js
```

The editor test exercises actual WebGPU display, Python rebuilds, preserved
camera state, and reopening the native cache with a nonexistent Python path.
CadQuery/OCCT are separately licensed dependencies; this project's MIT license
does not relicense them. Native dependency packaging and platform qualification
remain separate release work.

## Repeated assembly parts

A part record may contain `transform`, a row-major 3×4 rigid placement (12 finite
numbers, with a proper orthonormal rotation). Return the same prototype Shape
object for repeated occurrences. The worker validates and tessellates that
prototype once per build, transforms its mesh per occurrence, and retains exact
placed OCCT shapes for inspection/export. IDs and colors are per occurrence.
Scaling/reflections must be modeled explicitly; they are rejected as placements.
`timings.uniquePrototypes` reports the number of distinct input shapes.

Placed preview bounds conservatively transform the measured prototype bounding
box. They may be wider than exact rotated geometry; use the exact placed shape
in `cad-inspect` for dimensional measurements. Shared source dependencies are
hashed once per build before deriving component cache keys.

Preview `metrics.volume` uses OCCT fixed quadrature, identified by
`volumeMethod`. For precision checks on trimmed curves, use
`parts[i]["shape"].Volume(1e-7)` in `cad-inspect`; adaptive integration can be
expensive across hundreds of imported components. Solid validity remains checked
before any preview is accepted.

## Interpreter errors and external builds

The editor and CLI use the same interpreter resolver: explicit caller override,
`CADCOVE_PYTHON`, embedding project `pythonPath`, editor `instantcad.pythonPath`,
then `python3`. Project-relative executable paths resolve from the workspace.
Configure the environment containing the pinned requirements; startup errors
include the executable and a bounded stderr tail instead of only an exit code.

An open viewer watches its scene metadata as well as source files. A completed
external CLI build is adopted only after source/runtime/hash validation; this
can recover an editor Python failure without rerunning Python or moving the
camera. Incomplete, corrupt or stale scenes cannot replace the current model.

## Shared rotary mechanism metadata

A `mechanism.json` beside the Python entry describes fixed-base revolute joints,
rigid groups of occurrence IDs, and gear/belt/chain tooth-count relations. The
shared `core/mechanism.js` validates IDs, unit axes, bind angles, directed acyclic
relations and joint limits. `MechanismMotion` moves cached assembly instances;
it does not alter the authored BREP or mesh cache. Motor IDs resolve to their
shaft joint. Body origins and joint origins are world-space millimetres, axes
are unit world vectors, and angular coordinates are degrees. Relations use
`follower = direction * driverTeeth / followerTeeth * driver + phaseDeg`.
Bind angles must satisfy that equation. Initial tooth alignment is authored in
geometry; phase is a joint-coordinate offset, not automatic tooth alignment.

This first contract rejects floating/nested mechanisms and closed relation loops.
It does not infer teeth, simulate tooth contact, or deform belts and chain links.
The embedding application's simulation exporter supplies domain-specific physics
conversion; the generic CAD core has no FRC or physics-engine dependency.

### Live mechanism metadata

`mechanism.json` beside an entry is reserved for viewer motion definitions. It is
validated against the loaded part IDs independently of geometry. Editing this
file does not change the geometry revision or rebuild/upload meshes; the next
motion command loads it, stops any previous playback, and preserves unchanged
joint poses. Removed bindings return to their assembled positions. Invalid
metadata or a stale STEP source pin rejects the motion command.

Do not use this reserved file as an input to Python geometry. Put dimensions and
other CAD inputs in a separate JSON file (for example `dimensions.json`), which
remains part of the geometry revision. STEP assets remain content-hash tracked.
Editor source reads reuse file bytes only while file identity, size, modification
and change times match; new, changed and deleted files are checked each request.

### Hierarchical mechanisms

A moving body's joint may reference another moving body as its parent. Each
moving body has exactly one incoming joint, and every chain must end at a fixed
body. Cycles, missing parents and duplicate part ownership are rejected. Joints
can appear in any order. Gear/belt/chain relationships constrain joint angles;
the body tree separately determines which transforms those angles inherit.

For schema 1, part geometry, joint `origin` and unit `axis` are all expressed in
the **assembled CAD coordinate frame**, in mm; `bindAngleDeg` is the joint
coordinate at that pose. The viewer composes parent delta times child delta.
Do not pass a simulation's parent-local axis directly: first transform it through
the parent's assembled orientation and convert metres to mm. In particular,
imported swerve modules may already be steered even if simulation starts at zero.
Verify each rotational axis against the actual shaft/bore/cylindrical geometry.
Assign stationary housings to the parent and rotating parts to the child; an
unsplit bearing model cannot represent inner and outer race motion separately.

These rules apply to any assembly, including turret/hood, arm/wrist and
steering/wheel trees. No robot-specific identifiers are needed by the renderer.
Simultaneous parent and child motion uses independent tracks on the same clock.
The playback projection remains distinct from authoritative STEP kinematics;
import/export adapters must preserve frames and provenance rather than infer
mechanical intent from part names alone.

### Shared canvas controls and belt surfaces

`src/core/canvas-commands.js` implements the shared selection, highlighting,
visibility, reveal, camera and mechanism command contract. Hosts adapt their
render scale with `unitsPerMm`; public camera distances/pan use millimetres,
camera angles radians, joint angles degrees and trajectory time seconds.
Capability queries report the available commands; field/physics capabilities
belong to the embedding host. They do not change the generic CAD core.

An optional `mechanism.json` `beltSurfaces` array animates the existing belt
mesh. Each item supplies `id`, `part` (the belt occurrence), `body` (its rigid
parent), `relation` (a belt/chain ratio), `pitchMm`, `direction` (+1/-1),
`widthAxis`, and two `pulleys` with assembled `centerMm` and `pitchRadiusMm`.
Optional `toothCount` validates path length within 0.5 mm. Radius must match
relation teeth times pitch divided by two pi. Both pulley joints must share
that parent; centers can shift along their axles to the belt's width plane.
The current path implementation supports open two-pulley loops, including
unequal radii. Crossed belts and idler routes are rejected/not represented.

The renderer refines long travel-direction triangles once, then moves existing
vertices and normals around the pitch path using the driver's absolute angle.
Only the belt's GPU vertex ranges change per frame. Parent transforms carry the
belt with nested assemblies. Selection and captures use the deformed surface;
reset restores its original shape. Source CAD, disk mesh caches and exports
remain unchanged. This is presentation deformation, not elastic belt physics,
tooth-contact simulation, or manufacturing geometry.

## Experimental mechanism discovery

`src/native/discovery.py` exposes `discover(parts, cache_dir=..., ids=[...])`
for native inspection occurrence records, and `review(report, decisions)`.
This first pass measures analytic cylindrical axes and proposes nearby coaxial
surface pairs. It does not infer rigid groups, sliders, tooth ratios, limits,
actuation, one-way latches, or contact-driven deployment. A shared axis does not
prove a joint. Renders and component specifications supply additional evidence.
No proposal or confirmation automatically changes CAD or starts animation.

Analytic features are cached by unmeshed BREP content and analyzer/runtime
version. Top-level placements are separated; transformations baked into geometry
conservatively invalidate its feature entry. Pair checks use both geometry hashes,
placements and tolerances. Changed evidence makes prior confirmations stale.
Unchanged occurrences share cached features, including across Python restarts.
This cache does not tessellate shapes. Broad-phase bounds and coaxial checks are
not exact collision/clearance checks. Select subsystems to bound ambiguous results.

A decision names `candidateId`, `evidenceHash`, `decision` (`confirm`/`reject`),
and a nonempty `reason`. Confirmation also supplies `jointType` (`fixed`,
`revolute`, `cylindrical`) and `evidenceIndex` to select a measured axis. The
ledger is provenance for later authoring, not a new kinematic exchange standard
or a general constraint solver. Preserve authored/STEP kinematics separately;
never replace them with geometric guesses. An imported or authored shape goes
through the same evidence path, but known authored mechanical intent need not
be inferred again.

### Agent-controlled transparency

The shared CAD and field canvas command `opacity` changes only presentation.
Use `{"action":"set","scope":"only","ids":["part-id"],"value":0.25}`
to make specified parts 25% opaque, or `scope:"except"` to fade everything
except those parts. `names` accepts exact case-insensitive CAD names; omitted
targets use the current selection. `scope:"all"` targets all parts.
`{"action":"reset","scope":"all"}` restores opacity; `action:"state"`
reports non-default values. Values run from 0 (invisible) to 1 (opaque).
Hide/show remains independent. Invalid targets/values fail atomically.
Motion and selection preserve opacity, while a new scene or Escape resets it.
Headless assembly captures preserve opacity while neutralizing highlight colors.
Rendering sorts translucent occurrences back-to-front; intersecting translucent
surfaces may exhibit object-sorting artifacts. This is a visual inspection aid,
not geometric sectioning or a clearance check.
