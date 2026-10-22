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

## Point out parts to the student

Use MCP `cad_highlight` or `cadcove cad-highlight --workspace . --input highlights.json`
for temporary highlighting of exact occurrence IDs. Input:
`{"parts":[{"id":"motor-occurrence"},{"id":"pulley-occurrence","color":"#e95dca"}]}`.
Default cyan distinguishes agent highlights from yellow user selection. Highlight
multiple objects at once (up to 200); optional per-part colors distinguish groups.
Setting highlights replaces the previous set. They follow the rendered geometry
through camera and mechanism motion. Yellow user selection takes precedence;
deselecting restores the agent color. `cad-clear-highlights` removes only agent
highlights; Escape clears both. `cad-highlight-state` reads current highlights.
Rebuilds clear highlights; source colors, exports and captures remain unchanged.

Use MCP `cad_view` or `cadcove cad-view --workspace . --options view.json` to
control the live camera through the API. Options can combine a named `view`
(iso/front/back/left/right/top/bottom) with `ids` to fit those exact occurrences,
or `fit:true` to fit the whole scene. `pan:[x,y,z]` offsets the target in world
mm. `zoom:0.5` halves camera distance (zooms in). `camera` can override `target`,
`distance` (mm), `yaw`, and `pitch` (radians; 0 < pitch < pi).
Example: `{"ids":["motor-occurrence"],"view":"iso"}`.
`cad-view-state` reads the current camera. View changes preserve highlights and
selection; fitting does not hide occluding geometry. Prefer these controls to
mouse automation when explaining a mechanism.

For occluded components, use MCP `cad_reveal` or `cadcove cad-reveal --workspace .`
to alternate the current assembly view with only the currently highlighted parts. Optional
`--options reveal.json` accepts `ids`, `cycles` (1–10, default 2), `intervalMs`
(500–5000 per phase, default 1250). It restores prior visibility automatically
and preserves the camera and highlights. `cad-reveal-stop` or Escape stops it;
`cad-reveal-state` reports running/isolated state. Hidden tabs and rebuilds stop
the reveal. Fit the relevant parts with `cad-view` first when helpful.

Use MCP `cad_visibility` or `cadcove cad-visibility --workspace . --options visibility.json`
for persistent display-only hiding: `{"action":"hide"}` hides the user's selected
parts; `{"action":"isolate"}` hides everything except them. Specify `ids` or `names`
to target other parts, e.g. `{"action":"isolate","names":["Motor"]}`. Names match
exact CAD names case-insensitively, including every occurrence sharing the name.
Unknown names/IDs fail atomically. Resolve informal descriptions to inspected CAD IDs.
`show` restores specified parts; `show-all` restores everything; `state` returns
`hiddenIds`. The camera, highlights, source geometry and neutral captures stay intact.
Reveal temporarily shows its targets, then restores the prior hidden set. Escape
shows all and clears highlights/selection; a source rebuild also resets visibility.

`mechanism.json` beside the entry is reserved for live motion metadata, not Python
geometry inputs. Editing it does not rebuild meshes; the next motion command
validates and loads it while retaining unchanged joint poses. Put CAD dimensions
in a separate tracked JSON file. STEP sources remain hash-pinned. Use motion
reset, move or animate to reposition loaded mechanisms without source edits.

For any robot or machine, define a body tree: fixed base → moving assembly →
child mechanisms. Each moving body has one parent joint; part ownership is
exclusive. Schema-1 joint origins and axes use the assembled CAD frame, so
convert simulation parent-local frames before reusing them. Verify axes against
actual shaft/bore geometry, including imported steering poses. Keep stationary
housings on parents and rotating pieces on children. The generic viewer composes
parent and child motions; simultaneous tracks can drive steering and wheel spin,
or turret and hood, without rewriting geometry. Do not assume another robot's
axes, limits or part bindings. See the core native-CAD guide for frame semantics.

### Shared mechanism preview and direct physics (experimental)

Use `cadcove mechanism-preview-open --workspace . --field true` to place the
current cached native CAD in field context without Java, WPILib or Driver Station.
Omit `--field true` for an isolated mechanism. The configured field remains visual
context: this mode does not infer field collisions or game-piece interactions.
`mechanism-preview --action place --input placement.json` accepts
`{"position":[2,3,0.1]}` in metres; placement resets CAD motion to bind pose.

The `mechanism-preview` command takes `--action` and an optional `--input` JSON
file. `motion` accepts the same action/trajectory/part fields as `cad_motion`,
including synchronized tracks and explicit acceleration/jerk segments. `state`,
`view`, and `capture` query the preview; view camera positions are in metres.
The separate preview preserves the original source canvas and its geometry cache.
Click robot or field parts to select; Ctrl/Cmd-click toggles multiple parts.
`mechanism-preview --action state` includes selected IDs and names. Use
`--action selection` to read selection or set `{ "ids": [...] }`, and
`--action visibility` with hide/show/isolate/show-all. Selection is context;
motion can still target any defined joint without selecting it.
Reopen after a CAD or mechanism edit; stale definitions are rejected.

`--action physics` compiles the **same** mechanism definition into the native
engine and reuses those native CAD meshes. All parts must have a body, and explicit
physical properties must be present; missing data fails rather than guessing.
The experimental compiler supports revolute trees and compliant gear/belt/chain
ratios, box/cylinder colliders, and explicit motor electrical parameters. It uses
zero gravity and fixed roots for isolated mechanism commissioning; it is not a
free-driving whole-field simulator. It does not simulate belt teeth or tension.

`--action motors --input motors.json` accepts
`{"volts":{"motor-id":1},"seconds":2}`. This bounded simulated command supports
up to ±12 volts and 30 seconds. At expiry, applied voltage becomes zero; inertia
can continue the motion. `zero` removes motor voltage immediately; `cad` closes
the owned native process and returns to CAD bind pose. Closing the preview also
closes its native process. No Java process, Driver Station enable, vendor API or
hardware command is involved. Physics poses can differ from prescribed CAD paths.

Keep geometry dimensions in Python or an ordinary geometry data file, not the
reserved `mechanism.json`, which is intentionally excluded from geometry cache
invalidation. Joint motion data is an experimental projection; STEP provenance
checks do not imply every projected joint has been authored back to STEP.

### One command surface for CAD and field preview

Use `cadcove canvas --workspace . --action capabilities` (MCP `canvas_command`)
for the active source-CAD or field-preview tab. The shared actions are `state`,
`selection`, `highlight`, `opacity`, `visibility`, `reveal`, `view`, `motion`, and `capture`.

Use `opacity` to fade parts while keeping the complete assembly visible. Options
`{"action":"set","scope":"only","ids":["part-id"],"value":0.25}` make those
parts 25% opaque (75% transparent). Set `scope:"except"` to fade everything
except the targets, or `scope:"all"` without targets to affect the entire canvas.
Targets may also be exact `names`; omitted targets use the current selection.
Excluded parts retain their prior opacity. Use
`{"action":"reset","scope":"all"}` before a new focus shot to restore them.
`{"action":"state"}` returns nondefault part opacities. Opacity is a display
setting shared by CAD and field views; it survives motion and capture without
rebuilding geometry. In field mode, an `except` operation includes field parts;
target robot IDs with `only` when the field should keep its current appearance.
Use `--input request.json` for the action's options. `--target cad|field` selects
an explicit view; `--entry models.py` disambiguates source models. When multiple
canvases are hidden and none is active, targeting fails rather than guessing.
Legacy `cad-*` controls are compatibility aliases that follow the active canvas
unless an entry is supplied. `mechanism-preview` explicitly addresses its preview
and retains its legacy metre-based camera/placement options.

The unified API consistently uses millimetres for view/placement/capture lengths,
degrees for mechanism motion, radians for camera angles, and seconds for time.
Field preview adds `place`, `physics`, `motors`, `zero`, and `cad`. Native physics
state/world payloads retain SI units. Query capabilities rather than trying
unsupported operations. Motion commands never implicitly switch on physics.

Existing belt meshes can have optional `beltSurfaces` definitions next to their
belt relations: occurrence ID, parent body, relation ID, pitch, travel direction,
width axis and two pulley centers/pitch radii in assembled millimetres. The current
implementation handles open two-pulley paths, with optional tooth-count checks.
It deforms the existing surface for visualization, preserving source geometry
and caches. Teeth follow absolute pulley angle through reverse, pause, seek and
reset; nested parent motion carries the belt. Do not claim belt stretch, slipping,
contact forces or dynamic clearance from this visual feature.
