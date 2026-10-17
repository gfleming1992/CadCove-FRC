# Native CadQuery authoring

Read `.cadcove/project.json` first. A `.py` entry uses native CadQuery in the
local editor host. JavaScript CAD entries are no longer supported; migrate them
explicitly and validate the resulting geometry.
The native viewer uses the same mm/Z-up scene IDs, colors and WebGPU controls.

The host requires a trusted workspace and a Python 3.12 environment containing
`cadquery==2.6.1` and `cadquery-ocp==7.8.1.1.post1`. Set VS Code's
`instantcad.pythonPath` to its absolute Python executable. Dependencies are not
automatically installed. No AI API, NativeCAD server, or custom command language
is involved. Python code has the user's permissions; this is not a sandbox.

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
controlled surface patches. Historical geometry measurements are retained under
`native/evidence`; executable legacy CAD sources have been removed. Vendor and
unclassified components remain STEP and are reused by reference. Keep occurrence
IDs and placement when changing a part so simulation bindings can be reviewed
against the same mechanisms. See the robot's `native/README.md` before edits.
