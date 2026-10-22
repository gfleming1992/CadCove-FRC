# Native CadQuery authoring

## Animation to simulation

In the mechanism preview, `physics` stops animation and starts the native motor
simulation at the current displayed joint angles. The pose is preserved, including
nested steering/spin and coupled shafts; initial velocities are zero. This is a
pose handoff, not a transfer of animation velocities or a structural analysis.
The mechanism still needs explicit physical body, motor and transmission data.
Existing scripted animation remains available for mechanisms whose physical
parameters are incomplete. Returning to `cad` resets the preview to its bind pose.

## Optional solved motion and structural analysis

For an open robot with reviewed mechanism definitions, use
`cadcove cad-mates --action animate --workspace PATH --target cad --input motion.json
--output build/NEW_SOLUTION.json` (or `--target field`). The motion file is
`{"duration":5,"samplePeriod":0.02,"drives":[{"joint":"JOINT_ID","velocity":12}]}`.
Use the actual joint/part/motor ID from the mechanism. Configure the separately
installed solver with `CADCOVE_MATE_SOLVER` or `--solver`. This command reads the
current cached assembly and canvas pose, solves through Ondsel, and plays the
result locally. It preserves uncommanded coordinates, checks limits and stale
definitions, and never rebuilds geometry or silently falls back to scripted
motion. Pause/stop any active playback first; omitted position means the current
coordinate. The output must be a new file inside the workspace. A failed solve
does not change the canvas. A pose change during solving leaves the solution saved
but refuses playback. Capabilities describe supported relationships; contact and
missing hinge relationships still require separate modeling and validation.

Use `cad-mates --action inspect-step --input assembly.step --output NEW_REPORT.json`
to inspect standard kinematic entities through OCP. Select an interpreter exposing
`OCP.StepKinematics` with `--python` or `CADCOVE_STEP_PYTHON`; it is not installed
automatically. Ordinary STEP geometry may contain no kinematics. Inspect raw
frames, limits, authored coordinates and unsupported entities before inferring
anything. The report is not a solver request: units, frame context, and occurrence
bindings still require resolution. Do not label it a completed mechanism import.

For a reviewed mechanism tree, `cad-mates --action solve-mechanism --input REQUEST.json
--output NEW_SOLUTION.json` accepts `{mechanism, motion, sourceRevision}`. Motion has
duration, samplePeriod and polynomial drives (joint/part/motor target, absolute
position, velocity, acceleration, jerk). The adapter preserves bind angles, resolves
coupled targets, and checks travel extrema. Play the result with the shared canvas
`motion` action `play-solved` in CAD or field mode. Save the solution inside the
workspace and pass `options:{action:"play-solved",solutionFile:"build/solution.json"}`
to `canvas_command` with `action:"motion"`. The host reads the file locally (maximum
32 MiB), avoiding MCP's 64 KiB inline request limit. Read the current revision first;
do not rebuild geometry just to animate. Uncommanded joints hold bind pose, so supply
current positions explicitly when preserving a posed scene. This path calls Ondsel;
the existing tree animator remains available. Missing intake/contact relationships
are not inferred or repaired by conversion.

`cad-analysis --action prepare --workspace PATH --input analysis.json --output
NEW_REVIEW.json` reads the current CAD, checks the requested solid occurrence IDs,
and pins their geometry hashes. It preserves supplied hashes and rejects stale
ones; it does not invent material, loads, or restraints. Start with
`{"schema":1,"analysis":"linearStatic","units":"mm-N-MPa","parts":[{"id":"PART_ID"}],"outputs":["displacement","stress"]}`.
Read the returned `questions`, collect the missing physical facts, and use the
enriched `request` as the solve envelope's `analysis` property. Without `--workspace`,
prepare only reviews the supplied inputs and does not inspect CAD. Once inputs are
supplied, `cad-analysis --action solve --workspace PATH --input REQUEST.json --output
NEW_DIRECTORY` uses an optional, separately installed FreeCAD/Gmsh/CalculiX backend.
Configure absolute CADCOVE_FREECAD, CADCOVE_GMSH and CADCOVE_CCX paths explicitly.
Wrap the analysis with checked `references` and `mesh:{sizesMm:[coarse,fine],
relativeTolerance:...}`. Pin current shapeHash; provide material provenance, forces
in N, and supported restraints. This backend supports one solid, fully fixed faces,
and distributed face forces. Never invent robot loading or material properties to
make a solve run. Numerical success, convergence and engineering validation are
separate fields. Consult the generic core's DESIGN-SERVICES.md for scope.

Read `.cadcove/project.json` first. A `.py` entry uses native CadQuery in the
local editor host. Models use millimetres and Z-up coordinates, stable scene IDs,
explicit colors and interactive WebGPU viewing.

The host requires a trusted workspace and a Python 3.12 environment containing
`cadquery==2.6.1` and `cadquery-ocp==7.8.1.1.post1`. Set VS Code's
`instantcad.pythonPath` to its absolute Python executable. Dependencies are not
automatically installed. Python code has the user's permissions; this is not a sandbox.

Models define `def build(ctx)` (preferred for IDs/colors/caching), or assign `result` to a conventional CadQuery object. Build functions return a CadQuery Shape, Workplane, Assembly,
or a list of `{id, name, color, shape}` dictionaries. Use unique stable occurrence
IDs and explicit `#rrggbb` colors. Keep vendor STEP assets separate from authored
parts; preserve assembly placement and appearance rather than rebuilding vendors.
Use normal CadQuery and OCP APIs and ordinary Python modules.

```python
import cadquery as cq
from parts.rail import make_rail

def build(ctx):
    length = 650
    rail = ctx.component('rail', lambda: make_rail(length),
        dependencies=['parts/rail.py'], inputs={'length': length})
    return [{'id': 'left-rail', 'name': 'Left chassis rail',
             'color': '#b0b5bb', 'shape': rail}]
```

For `ctx.component`, omit `dependencies` to conservatively depend on all tracked
inputs. If narrowing it, include every transitive module and asset the factory
uses, plus changing arguments in `inputs`. Sources track Python, JSON, STEP/STP
and BREP under the configured source directory. Avoid time/network/environment
inputs and untracked data formats. `ctx.import_step(path, sha256=None)` and
`ctx.read_asset(path, sha256=None)` keep paths within that directory.

## CLI session

Set `CADCOVE_PYTHON`, `.cadcove/project.json`'s `pythonPath`, or `--python` to the
Python executable. For the editor set `instantcad.pythonPath` to the same one.
The packaged CLI includes cad-requirements.txt; install those pinned dependencies
in a dedicated venv. Do not overwrite the team's global Python environment.

`cadcove cad-build --workspace . [--entry models.py]` needs no editor. It writes
the same revision-bound scene cache used by the WebGPU panel. `cad-inspect
--script checks.py` builds and executes checks; `cad-export --output model.step`
builds and exports colored STEP. The one-shot commands start a fresh worker.

For rapid iteration run `cadcove cad-session --workspace .` and send JSONL:

```json
{"id":1,"op":"build"}
{"id":2,"op":"inspect","code":"result = [{ 'id':p['id'], 'volume':p['shape'].Volume() } for p in parts]"}
{"id":3,"op":"export","output":"build/robot.step"}
```

Edit source normally, then send another build. Every response has the request ID
and `ok`; inspect/export refuse stale source. Python exceptions return errors
without ending the session. EOF terminates the worker. This is a local trusted
process, not a sandbox. Logs go to stderr; stdout stays structured JSON.
The model runs with source root as cwd; `ctx.build_dir` is the output directory.
Keep generated data out of source; tracked imports are Python/JSON/STEP/BREP.

Use `cadcove cad-capture --workspace . --view front --ids ID --output build/front.png`
with the configured model open in VS Code. Standard views are iso/front/back/
left/right/top/bottom. Omit IDs for the full assembly. Capture preserves the
live camera and returns the accepted revision. Rebuild after a failure; do not
interpret the retained last-good canvas as current success.

CAD rendering success does not rebuild simulation collision/mass data. Follow
`physics-authoring.md`, regenerate source-bound artifacts, and verify bindings
before simulation. Keep the team robot code and Rapier runtime independent of
which CAD authoring backend is selected.

## Included Team 3310 example

The full example opens `cad-assets/robot/models.py`. Its 109 authored designs
live in `native/parts/p_*.py`, with stable asset-to-module mappings in
`native/migration.json`. Follow helper imports for dimensions, profiles and
controlled surface patches. Geometry measurements are retained under
`native/evidence`. Vendor and
unclassified components remain STEP and are reused by reference. Keep occurrence
IDs and placement when changing a part so simulation bindings can be reviewed
against the same mechanisms. See the robot's `native/README.md` before edits.

## Experimental connection discovery

Use `cadcove cad-discover --workspace . --ids SHAFT_ID,BEARING_ID --output
build/discovery-report.json` to propose nearby coaxial connections from exact
geometry. The report lists measured axes/radii, evidence hashes and unresolved
intent. This currently detects cylindrical-axis candidates only; it does not
recover complete mates, sliders, rigid groups, transmissions or physical stops.
Preserve existing authored/imported kinematics. Never replace them with a guess.

The separate analysis cache reuses unchanged part features and occurrence-pair
checks across runs. Placement changes invalidate affected pair evidence; geometry
changes invalidate that part's features. The one-shot CLI still builds/loads CAD
using the existing component cache. For repeated analysis without that scene
serialization, use a warm `cad-session`: after `build`, send
`{"op":"discover","ids":["shaft","bearing"]}`. Neither path tessellates as part
of analysis itself. Baked-in geometry transforms conservatively invalidate more.

Save decisions as a list with `candidateId`, `evidenceHash`, `decision`
(`confirm`/`reject`) and `reason`. Confirmation additionally requires `jointType`
and `evidenceIndex`. Pass `--decisions FILE.json` on a new scan, or `decisions`
in the warm request, to check them against current geometry. Changed or removed
evidence is marked stale. Reports refuse to overwrite existing files.
Confirmations are review evidence only, not live motion commands or a competing
kinematics standard. Explicit joint authoring and a constraint-solver adapter
remain separate work. Interference and swept-motion checks are not implied by a
candidate or a confirmation.

### Optional headless assembly solving

`cadcove cad-mates --action capabilities` reports the experimental Ondsel bridge.
With an explicitly installed `CADCOVE_MATE_SOLVER`, use `--action solve --input
REQUEST.json --output NEW_RESULT.json`. Read `vendor/cad-core/docs/ASSEMBLY-SOLVER.md`
in the source checkout for frames, units and examples. The adapter accepts reviewed
fixed/revolute/slider mates, including closed loops, and explicit timed drivers;
it does not infer intent, check collision, or supply physics properties. Never
silently promote `cad-discover` proposals to joints. A solver request contains
transforms and mates only, so repeated solves reuse existing geometry. Include the
current CAD source revision and occurrence bindings to display the result using
canvas motion action `play-solved`; stale solutions are rejected. Reset before
switching back to tree-joint animation. This optional library is not automatically
installed and its new closed-loop results are not yet accepted by physics export.

### Optional sketch solving, checked references, and analysis intake

`cadcove cad-sketch --action capabilities` describes the optional PlaneGCS
interface. Use `--action solve --input sketch.json --output new-result.json
--python PYTHON` with explicitly installed `planegcs==0.9.6`. Check `ok`,
constraint diagnostics and remaining degrees of freedom before constructing CAD.
Do not silently remove conflicting constraints. This changes sketch coordinates,
not assembly motion; Ondsel handles assembly mates. The full source contract is
in `vendor/cad-core/docs/DESIGN-SERVICES.md`.

`cadcove cad-references --workspace . --input references.json` checks explicit
named cylindrical feature datums against current exact geometry. A warm session
accepts `op:references`. Check nested `result.ok`; missing and ambiguous matches
are failures, never permission to attach a joint to the closest face. Recompute
authored datums from the same design parameters after edits. This is not general
FreeCAD topology-history recovery or inference of missing STEP intent.

For a requested finite element analysis, first reuse evidenced material and load
data, then use `cadcove cad-analysis --action prepare --input analysis.json
--output new-review.json` to identify missing inputs. Ask for material grade,
loads/directions, supports and desired outputs; retain assumptions explicitly.
The current command only prepares an input review. It does not run a structural
solver, verify restraints, mesh, or certify strength. Never turn inputComplete
into a claim that analysis ran. Keep any future analysis bound to current CAD
references and require mesh-convergence checks before interpreting results.
