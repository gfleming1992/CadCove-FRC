# Native CadQuery migration: implementation and measured gate

## Status

The editor supports native `.py` CAD through the pinned generic core. Python
uses native CadQuery/OCP; the viewer remains WebGPU, and FRC simulation remains
Rust/Rapier. Native CadQuery is now the default authoring backend for new
workspaces, following review of the cold-start tradeoff below. Existing projects
keep their configured entry point. The team example now defaults to `models.py`:
all 109 authored designs use native CadQuery, with 320 vendor/unclassified STEP
assets retained. See the full-robot validation and timings at the end of this file.

The earlier representative geometry, CLI and installed-editor measurements below
document the migration stages. They do not substitute for full-robot validation.
The final migration evidence includes a known STEP exchange limitation on two
rails; the native solids and BREP representation are the validated geometry.

## What works

- Persistent local CadQuery worker, bounded request timeout and cancellation.
- Full Python CadQuery/OCP source, local module imports and STEP import helpers.
- Stable part IDs, explicit colors, CadQuery Assembly placement, shared mesh codec.
- Cached scene display without starting Python; verified cache digest and source
  revision, including the native worker's content hash.
- Source watchers, current-revision feedback, last successful scene after errors,
  safe component cache reuse, preserved camera and unchanged GPU batch reuse.
- Existing `open_robot_cad`, `open_cad_model`, `cad_status` and `capture_scene`
  agent tools work with a configured Python entry.
- Worker code and requirements are copied into the VSIX media assets. Python and
  binary dependencies are user-installed, not silently downloaded or bundled.

## Setup

Use Python 3.12 and install
`vendor/cad-core/src/native/requirements.txt` in a separate virtual environment.
Set VS Code `instantcad.pythonPath` to its absolute Python executable. Configure
`.cadcove/project.json` with `entryPoint: "model.py"` and the existing source/build
folders, then open CAD. Read
[the generic backend contract](../vendor/cad-core/docs/NATIVE-CADQUERY.md) and
[agent guidance](../agent-skills/references/native-cadquery.md).

A native model defines `build(ctx)` and returns ordinary CadQuery geometry or
stable `{id,name,color,shape}` records. It is trusted local code, not a sandbox.
The static website continues to execute its browser JavaScript backend.

## Initial three-part profile: Apple M5 Mac, 24 GiB RAM, 2026-10-17

Fixtures: three actual robot designs (wire profile, a perforated mechanism plate,
and a larger plate with many cutouts), totaling **29,824 triangles**. Both backends
use absolute 0.12 mm / 0.35 rad tessellation. The edit increases the mechanism
plate depth by 1 mm; two unchanged components remain cache hits.

| Operation | Native CadQuery | Existing WASM |
|---|---:|---:|
| First build, including process/kernel startup | 1,909 ms | 760 ms |
| Warm unchanged rebuild, median of three | 38.4 ms | 45.3 ms |
| One-part geometry edit | 83.6 ms | 144.7 ms |
| Warm edited scene, median of two | 38.8 ms | 44.7 ms |

These are harness wall times, including source gathering, dispatch and build
response; they exclude GPU upload, viewport draw and screenshots. The first run
means a fresh CAD process/kernel, **not** an OS-cold disk cache or new-machine
installation. One local run with a few samples is not a capacity benchmark.

Geometry checks: valid solids, matching triangle counts, and relative volume
error at most **3.8 × 10⁻¹⁶**, before and after the edit. This is representative
coverage, not a geometric equivalence proof for all 109 authored robot designs.
Native bounds use exact geometry instead of the existing triangulation-expanded
bounds; they are not expected to be byte-identical. Visual/semantic equivalence
of the complex curved and filleted parts is still unqualified.

Native worker resident memory was **521–523 MiB** for this workload. The installed
Python environment occupied **902 MiB** on disk, including upstream dependencies.
These are not geometry-only costs. The in-process component cache accounted for
about **4.4 MiB**. WASM harness RSS is recorded in raw results but is **not a fair
memory comparison**: it includes the Bun harness, source/compiler buffers and
allocation retention. No total browser-versus-native memory claim is made.

One identified native bottleneck was OCP TriangleArray iteration through Python
(~1.5 s on the large plate). Indexed triangle access reduced the combined three
parts' tessellation to ~0.30 s. Warm rebuilds check BREP signatures before reusing
cached validation/mesh data; copies prevent mutating the canonical cache.

## Reproduce

Requires the trusted team example source pack, its JS dependencies, and a Python
executable with the pinned native dependencies:

```sh
bun scripts/profile-cad-backends.js \
  /path/to/robot/source/cad-assets/robot \
  /absolute/path/to/venv/bin/python \
  build/native-cadquery-profile
```

Generated JSON/Python fixtures and `results.json` remain under the supplied output
folder. Source files are read, not overwritten. This command executes the selected
source modules, so do not point it at an untrusted pack.

```sh
CADCOVE_PYTHON=/absolute/path/to/venv/bin/python bun run test:toolbox
```

The generic core's actual VS Code/WebGPU integration test verified
Python builds, hot-swap camera preservation, and cache reopening with an unusable
Python path. All 111 portable/native contract tests passed. A fresh installation
of the packaged development VSIX also passed Python opening through MCP, native
rebuilds, packaged CLI feedback, MCP image capture and cache-only reopening. Its
simple native edit reached the displayed frame in 53.3 ms; the initial build was
1,999 ms. The existing team simulation started, accepted controls and shut down
cleanly in that same installed-extension run. Tests so far are on macOS arm64. Windows/Linux native dependency
installation, full robot conversion, collision recooking, public release packages
and cross-platform qualification remain outstanding. Nothing was pushed to GitHub.

Local development artifact: `artifacts/cadcove-frc-native-cadquery-20261017.vsix`
(about 199 MB, including the existing team example; Python is external). Installed
test report: `artifacts/toolbox-extension-test-report.json`.

## CLI-first workflow (2026-10-17)

New workspaces now select `models.py`. `cad-build`, `cad-inspect`, and
`cad-export` work without the editor. `cad-session` keeps one Python worker alive
for JSONL build/inspect/export requests and exits on stdin EOF. Source identity
and scene encoding are shared with the editor, not a second CAD implementation.
`cad-capture` uses the installed VS Code WebGPU canvas, fits requested occurrence
IDs, preserves the visible camera, and rejects stale source revisions. Standard
views include iso/front/back/left/right/top/bottom. The agent's own filesystem
and CLI tools drive repair iterations; no agent-facing MCP setup is required.

Evidence: 113 portable/native tests passed; the installed macOS arm64 VSIX passed
actual WebGPU captures, preserved camera, Python edits, cached reopening, and
existing CTRE simulation checks. A compiled standalone CLI separately built an
80×40×6 mm plate with an 8 mm hole in 1,191 ms wall time: 1,140 ms worker startup,
14.3 ms model construction, 6.0 ms tessellation. This is a small smoke fixture,
not a full-robot performance result. Python dependencies remain separately
installed; Windows/Linux execution is not qualified by these macOS tests.

The robot source migration is being validated separately. Do not interpret
availability of the native CLI or a migrated subset as full assembly parity.

## Final CLI revision check

After the multi-solid and stale-feedback fixes, the same three-part fixture was
re-run on this Mac. A fresh native process took 1,894 ms, including 1,173 ms of
worker initialization. Warm unchanged builds had a 42.7 ms median, and a one-part
edit took 120.8 ms. The corresponding WASM results were 825 ms, 49.5 ms and
159.0 ms. Native volume metrics now use adaptive integration at 1e-7 tolerance;
metrics and mesh-file encoding have separate reported timings. These measurements
exclude GPU upload and do not predict full-robot assembly time.

113 portable/native tests passed after these changes. Multi-solid Workplanes and
STEP imports preserve all solids. Exact inspection/export rejects changed source;
a rejected build requires a successful rebuild before exact feedback. Disk caches
retain the previous good scene for viewing. These are revision guarantees, not a
sandbox for untrusted Python.

Final development package: `artifacts/cadcove-frc-benchcad-workflow-20261017.vsix`.
SHA-256: `c06c62206169b74d5bd9acff999abbc8b6e16c3d545bc77516bff3c6277aa0b5`.
A fresh isolated VS Code 1.105.1 installation passed on macOS arm64, including
native builds/edits, focused WebGPU capture, preserved camera, cache-only reopen,
packaged CLI feedback and the existing real CTRE simulation. The machine's
separately installed pinned Python environment was supplied to the test.
Nothing in this result qualifies Windows/Linux or the unfinished robot port.

## Full Team 3310 native migration (2026-10-17)

All 109 authored designs now build in CadQuery; 320 vendor/unclassified designs
remain STEP imports handled by native OCCT. The 1,958 occurrence IDs, placements
and colors are preserved. The browser continues to render WebGPU meshes.
Native part validity, meaningful parameter edits, current-WASM surface/Boolean
comparisons and the known rail STEP exchange issue are recorded in
`examples/team3310-rebuilt/source/native-migration-validation.json`.

The previous three-part timing above is **not a full robot build time**. Full
assembly profiling exposed repeated placement-bound solving, adaptive volume
integration on the preview path, and a component cache too small for this robot.
The worker now reuses prototype tessellations, conservatively transforms preview
bounds, hashes shared source dependencies once, and uses standard OCCT preview
volume integration. Exact shapes and adaptive mass checks remain available to
`cad-inspect`. Its bounded component cache now reports working-set size and
retention; its accounting estimate is not process RSS. The final 640 MiB cap
fits this robot's measured 568 MiB component working set. Unused components are
dropped after an accepted revision, so this is not an accumulating revision cache.

### Full assembly measurements

Measured on the same M5 Mac with the final native worker and the actual 1,958-part
`models.py` assembly. Cold means a fresh Python worker and empty component cache;
it does not mean a cold operating-system filesystem cache. Warm means another
explicit build in the same session. These are single local runs, not percentiles.

| Stage | Cold build | Warm unchanged build |
|---|---:|---:|
| Python/kernel startup | 1.210 s | Already running |
| Model construction/import and placement | 56.598 s | 3.267 s |
| Solid validation/signature checks | 2.260 s | 2.241 s |
| Tessellation/mesh placement | 14.140 s | 0.275 s |
| Preview metrics | 22.228 s | 0.025 s |
| Scene encoding | 0.045 s | 0.065 s |
| Worker build total, excluding startup | 95.358 s | 6.037 s |
| Session wall time, including source/cache I/O | **97.311 s** | **6.749 s** |
| Component cache hits / misses | 0 / 429 | **429 / 0** |

The final scene is 185,906,192 bytes (177.3 MiB). Component accounting is
595,981,128 bytes (568.4 MiB); this is not resident memory. There are 429 source
prototypes and four occurrence-specific, mass-checked vendor wheel tolerance
repairs. All 1,958 final placed shapes pass native OCCT validity inspection.
The packaged example includes the validated scene cache, so opening an unchanged
robot should not invoke either build above. GPU upload/draw and editor startup
are excluded from these build measurements and tested separately below.

The initial full-robot implementation took 255 seconds cold in an earlier run;
the final measured build takes 97 seconds. Different runtime conditions and the
small sample count prevent treating that as a universal speedup. No claim is
made that native CadQuery builds this entire robot faster than WASM: the full
WASM assembly has not been timed under equivalent final conditions.

### Final packaged-extension qualification

`artifacts/cadcove-frc-native-robot-20261017.vsix` was installed in a fresh isolated
VS Code 1.105.1 profile on macOS arm64. Its SHA-256 is
`228e81580c861956ba4dba0c91a9b7a0b133f2b74c1d826b5d545f6d38d3d958`.
The runtime is `0.1.11-native-preview`, generic core
`33a89e99c7e207db7de7b58027a8f83758fec874`.

- 118 portable/native tests passed (10,558 assertions).
- The extension-created team example defaults to `models.py` and displays all
  1,958 occurrences from a validated disk cache with `workerLoaded: false`.
- A real WebGPU isometric capture was inspected: the full robot, its colors and
  assembly placements are visible.
- Native Python edits, focused image feedback, camera preservation, packaged CLI
  feedback and cache-only reopening passed the installed-editor tests.
- The packaged actual WPILib/CTRE robot ran in teleop, drove 1.29 m in the control
  check, and shut down cleanly. This retains the reviewed collision baseline; it
  does not recalibrate robot mass/materials or certify hardware behavior.

The local report is `artifacts/toolbox-extension-test-report.json`. This is a
development VSIX, not a published release. Python dependencies remain separately
installed. Windows/Linux and Marketplace/binary-redistribution gates are not
qualified by this macOS run.

The shipped team example includes a source/runtime-hash-validated native scene
cache. Opening that cache does not start Python. Editing still requires the
pinned local CadQuery environment. Legacy JS remains available for compatibility,
but fresh team workspaces select `models.py`.


## CAD display detail and field materials

The shared renderer uses smooth shaded surfaces without an edge-line overlay.
Opaque assembly drawing uses reusable WebGPU render bundles; transform/color
writes keep the bundle valid, while changed visibility, transparency, or topology
rebuilds it. Captures use the same surface pipelines with independent bindings.

The pinned native field importer retains STEP/XCAF surface opacity and uses
0.12 mm absolute deflection and 0.15 rad angular deflection for presentation
meshes. An `--appearance-only` refresh updates those display assets without
rewriting STEP components, physical properties or occurrence bindings. The
single-material path uses its presentation mesh too. Existing caches must be
refreshed explicitly to obtain the new surface detail; ordinary reopen and
motion reuse the cache.

Opacity overrides are temporary display settings; reset returns to the imported
material alpha. Transparency uses sorted occurrences with no depth writes, so
intersecting translucent surfaces can still exhibit sorting artifacts. No
texture, refraction, metallic finish, ambient occlusion or automatic net openings
are synthesized. An opaque solid used to represent a net in STEP remains an
opaque solid. This is a shaded CAD inspection renderer, not a photorealistic
material renderer or a claim of parity with every commercial CAD display mode.
