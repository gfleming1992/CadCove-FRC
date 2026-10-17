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
cached builds. STEP hashing cost is part of source scanning; a large source pack
still needs profiling before switching its default backend.

`ctx.component(name, factory, dependencies=None, inputs=None)` caches exact
geometry and meshes in the warm process. By default every tracked source is a
dependency. Narrow that list only when it includes **all transitive source and
asset dependencies**, and put changing arguments in `inputs`. For example:

```python
shape = ctx.component("rail", lambda: make_rail(length),
    dependencies=["parts/rail.py", "parts/common.py"], inputs={"length": length})
```

The cache returns copies and checks BREP signatures before reusing meshes, so
mutating a returned shape cannot corrupt the canonical component cache. Failed
builds do not replace the accepted scene. Unused cache entries are dropped after
successful builds, with a 640 MiB accounting cap based on BREP/mesh sizes. This
is **not** an RSS limit: OCCT, Python and the accepted scene also consume memory.

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
