# CAD authoring: Python, CLI feedback, WebGPU viewing

Read `.cadcove/project.json`; use its source/build directory and entry point.
New models use `models.py` (or another configured `.py`), native CadQuery/OCCT.
Read `native-cadquery.md` for the executable contract and warm-session commands.
Right-click Python/STEP files in VS Code to open the interactive WebGPU canvas.
No CAD buttons, chat panel or MCP setup is needed for agent modeling.

Use the full CadQuery/OCP API. Keep dimensions, manufacturing intent, reusable
parts and assembly placement explicit. Import vendor STEP; author custom parts
in Python. Preserve occurrence IDs and colors when editing a larger assembly.
Use conventional Python functions/classes, loops, sketches, selectors, sweeps,
lofts, fillets, booleans and geometry checks rather than inventing a limited DSL.

## Execute → inspect → render → repair

1. Plan dimensions, coordinate frames and engineering constraints.
2. Write/edit Python; `cadcove cad-build --workspace .` reports validity,
   volumes, bounds, triangle counts, source revision and stage timings.
3. Run exact checks with `cadcove cad-inspect --workspace . --script checks.py`.
   `parts` contains ID-tagged exact CadQuery shapes. Assign JSON-safe `result`;
   use Python assertions for required constraints. Geometry inspection and
   numerical/boolean checks are stronger than a screenshot alone.
4. With the model open in the editor, `cadcove cad-capture --workspace .
   --view iso --ids PART_ID --output build/check.png` fits just the edited part.
   Capture front/right/top as necessary. Read the PNG using the agent's image
   tool. It uses the actual WebGPU renderer and preserves the user's camera.
5. Repair source using actual Python exceptions, check results and images.
   Keep the last accepted version; a still-visible old scene does not prove
   the new build worked. Finish only after requirements and visuals agree.

For repeated work keep `cadcove cad-session --workspace .` running and send
JSONL build/inspect/export operations. This avoids repeated Python imports.
No hidden model reasoning or automatic retry policy is imposed by the CLI.

This supports CadQuery program generation and editing with execution-grounded
feedback, aligned with [BenchCAD's task definitions](https://github.com/BenchCAD/BenchCAD-main).
It is not a claim of a BenchCAD score or an identical evaluation harness. Its
canonical Vision2Code input is four diagonal rendered views; our focused views
are interactive authoring feedback, not interchangeable benchmark inputs.
CAD remains mm/Z-up; physics is metres/SI. Rebuild collision/bindings after
geometry changes. See physics-authoring.md for team-owned Rapier worlds,
accurate/gameplay profiles, source fingerprints, and calibration provenance.

## Fast edits in an open canvas

The editor keeps a native worker warm and rebuilds on source saves. Do not start
an additional cold `cad-build` for every edit while that canvas is building;
wait for its revision-matched `cad-status`, then capture it. Use `cad-session`
for warm headless iterations when no editor build is running.

Declare every component's actual dependencies with `ctx.component`. Keep each
part's profile JSON in its own dependency list; putting every profile in a
shared list invalidates the whole authored assembly on a single-part edit.
Include shared helper code/data and explicit parameter inputs. Never omit a
real dependency just to improve cache hits. Check `timings.components` for hits
and misses and `timings.client` for frame/upload costs before optimizing.

The native component cache also persists beside the scene under `components/`.
After a worker/editor restart, unchanged components can load their exact BREP,
mesh and metrics from disk. `timings.components.diskHits` reports that reuse.
Cache keys include the native runtime, source dependencies and explicit inputs;
a runtime upgrade needs one new population build. Corrupt cache entries rebuild
from source automatically. Generated component files must stay out of Git.

## Inspect mechanism motion

For CAD rotation/animation use `cad-rotate`, `cad-animate`, `cad-motion-stop`,
`cad-motion-reset`, and `cad-motion-state` with `--workspace`, optional `--entry`,
and an explicit part/joint/body/motor ID. The entry must have an adjacent
`mechanism.json`; axes, rigid groups and gear/belt/chain ratios are authored there.
Never infer an ambiguous shaft axis or tooth ratio silently. Rotation uses
absolute degrees; animation uses RPM and a bounded duration. These commands move
cached meshes without geometry rebuilds and never command real hardware.
`mechanism-export` reuses that metadata for native physics bodies, joints, motors,
transmissions and occurrence bindings; missing physical inputs fail explicitly.
See `examples/rotary-mechanism/README.md` in the source distribution for the schema
and the complete gear/pulley/chain/motor-shaft example.

## Selecting a part in the canvas

Click a part for a yellow display highlight; Ctrl/Cmd-click toggles additional
parts. Empty-space click or Escape clears selection. Dragging still orbits/pans,
and middle-drag draws red markup. Read exact selected occurrence IDs and names
with `cadcove cad-selection --workspace .` (or MCP `cad_selection`) before acting
on requests such as “this belt”. Selection is transient and does not change CAD
source, mesh caches, or export colors. IDs survive a rebuild only while present.

## Explicit motion timelines (experimental)

Selection provides context, not authorization or a restriction on targets. Use
`cad-selection` for occurrence IDs and `cad-mechanisms` to discover defined
joints, rigid bodies, relations and motors. `cad-rotate --part ID --degrees N`
sets an absolute joint coordinate; `cad-move` adds a relative angle. These are
instantaneous temporary viewer poses, not physical motor commands.

`cad-motion-play --workspace PATH --input trajectory.json` submits one atomic
batch and returns a playback ID immediately. All tracks share the canvas clock.
The current prototype reads `mechanism.json`; standard STEP integration is still
experimental and this JSON is not a substitute for interoperable STEP entities.
Example: rotate 90 degrees in four seconds, starting from rest at zero:

```json
{"units":"deg-s","tracks":[{"target":"shaft","endPosition":90,"segments":[
  {"seconds":1,"acceleration":30},
  {"seconds":2,"acceleration":0},
  {"seconds":1,"acceleration":-30}
]}]}
```

Angles use degrees, time seconds, velocity degrees/second, acceleration
degrees/second² and jerk degrees/second³. Each segment has constant `jerk`
(default zero); omitted acceleration continues the preceding segment's ending
acceleration. Initial track `velocity` and `acceleration` default to zero;
position starts at the current displayed joint coordinate. `startSeconds` delays
a track at rest. Optional `endPosition` checks the calculated endpoint.

Tracks must finish at rest; completed tracks hold position. Reversals are
explicit segments with signed acceleration, not ambiguous easing names. Integer
`repeat` repeats a batch only if every track returns to its starting position.
Total playback is at most 300 seconds. Coupled joints follow the mechanism's
ratios; two tracks driving the same coupled group are rejected. Position limits
are checked at segment endpoints and interior extrema before playback starts.

Use `cad-motion-pause`, `cad-motion-resume`, `cad-motion-seek --seconds N`,
`cad-motion-stop`, `cad-motion-reset`, and `cad-motion-state`. Seek pauses at an
absolute timeline position. Stop holds the displayed pose; reset restores the
CAD bind pose and discards playback. A new play command replaces the preceding
batch only after validation. A geometry reload invalidates playback. No geometry
rebuild is required for motion. This is kinematic visualization, not collision
checking or a claim that real motors can achieve the requested trajectory.
