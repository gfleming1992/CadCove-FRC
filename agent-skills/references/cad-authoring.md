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
