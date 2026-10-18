# CadCove-FRC — system card

Release candidate: native CadQuery edition, October 2026.

## What it is

An MIT-licensed, local, agent-friendly CAD + robot-code + simulation workspace
for VS Code and WPILib VS Code. Teams keep editable geometry, robot code, physics
configuration, and build artifacts together in their repository. Their existing
coding agent operates through files, a structured CLI, and optional MCP tools.
CadCove contains no hosted AI model, API key requirement, or embedded AI chat UI.

## Architecture

| Layer | Implementation | Responsibility |
| --- | --- | --- |
| CAD source | Python / CadQuery 2.6.1 | Parametric parts, assemblies, vendor STEP imports |
| Geometry | Native OCCT 7.8.1.1 via OCP | BREP modeling, validation, tessellation, STEP exchange |
| Viewer | Shared WebGPU renderer in VS Code webview | Colored meshes, pan/zoom/orbit, focused captures |
| Agent interface | Local CLI, files, optional MCP | Build, inspect exact geometry, capture, export, simulation queries |
| Robot program | Java / WPILib with supported Phoenix 6 adapters | Actual team control code and simulated device state |
| Physics | Native Rust / Rapier | Rigid bodies, contacts, mechanisms and season interactions |
| Season/example data | Separate source packs and manifests | Swappable robot, field, rules knowledge and calibration |

Python/CadQuery runs locally on the user's machine. The VS Code webview renders
the resulting meshes with WebGPU.

## Agent feedback loop

1. Read team instructions, design requirements, CAD source and season references.
2. Edit ordinary Python or robot code.
3. Build and examine actual exceptions, validity, bounds, volumes and timings.
4. Run exact geometric assertions; capture focused views from the WebGPU canvas.
5. Repair, repeat and accept only revision-matched results.
6. Rebuild/review simulation bindings and calibration after CAD changes; run robot
   code with structured state/object queries, controller inputs and scene captures.

This is inspired by execution-and-visual-feedback CAD workflows, including
BenchCAD. We have not measured a BenchCAD score and do not claim benchmark parity.
Agents author ordinary Python using the CadQuery and OCP APIs.

## Cache and editing behavior

Sources are fingerprinted with their configured entry and native worker identity.
Warm workers cache reusable BREP components and tessellations. Dependency-aware
components reuse unchanged prototypes; assembly occurrences keep stable IDs and
colors. The viewer preserves camera state when accepting a rebuilt scene. Failed
builds retain the last accepted scene but report an error rather than claiming
that retained geometry is current. Valid saved mesh caches can open without
starting the CAD worker. Generated artifacts belong under the configured build
folder and can be regenerated.

## Example and fidelity

The included Team 3310 Amarillo example has 1,958 occurrences: 109 authored
CadQuery part designs and 320 retained vendor or unclassified STEP prototypes.
The REBUILT field is downloaded directly from FIRST using a pinned checksum;
its 6,186 occurrences are reconstructed locally with placement and appearance.
The native field importer preserves 431 prototypes, 51 multicolor occurrences,
and a 33-color palette.

The example includes robot code, mechanism mappings and reviewed collision
approximations. A STEP assembly alone cannot reliably infer motor IDs, wiring,
ratios, material density, inertia, friction or control semantics. Teams and agents
must supply or review those inputs. Unknown calibration remains explicit.

## Simulation modes and limits

Gameplay mode prioritizes interactive driving using documented simplifications.
The more detailed mode retains more contact fidelity and can run slower than
wall clock. Both use native CPU physics; neither is a substitute for physical
robot testing, hardware safety checks or competition inspection. Timing depends
on the CPU, active contacts, mechanisms, timestep and ball activity. A smooth
WebGPU view does not prove the physics is keeping up; the viewer exposes pace.

The bridge targets documented Java/WPILib/Phoenix interfaces. It does not promise
universal support for every vendor device or every team's program without work.
Limelight observations are simulated approximations, not photoreal sensor truth.

## Trust, privacy and licensing

Only open trusted workspaces: CAD Python and robot programs execute with the
user's permissions. Local process authentication protects editor tool endpoints;
this is not a hostile-code sandbox. The user's chosen AI agent may send source
or captures to its provider under that agent's configuration. CadCove itself
requires no remote AI service. Keep generated endpoint tokens and private season
manual imports out of version control.

Original CadCove code is MIT. Dependencies, team assets and FIRST content retain
their own terms. Native Python packages are installed separately. Release packages use a small Rust CLI launcher and bundled JavaScript. Bun 1.4.2
is installed separately; no Bun binary, JavaScriptCore or Bun embedded libraries
are redistributed. The optional standalone developer package still carries its
unresolved redistribution gate. Packaged Rust/JavaScript dependency notices
are included and checked.

## Release-candidate distribution checks

The external-Bun package passed 114 portable/native CAD contracts, relocated
CLI/native-runtime checks, and installation into VS Code 1.105.1. The same local
package passed with WPILib 2026.2.1 companions and the actual Java/Phoenix example:
CAD edits/cache/captures, runtime repair, teleop control requests, live simulation
rendering/capture and clean shutdown. See the [local external-runtime evidence](release-evidence/external-bun-macos-wpilib.json).

The final GitHub prerelease attaches per-platform checksums, notices and test
reports binding the downloaded VSIX to its qualification. CI uses software GPU
rendering; full vendor/hardware checks have narrower scope and are identified
separately. Windows validation remains pending. The updated native-CadQuery
launch film is attached to the prerelease with source/cut provenance and its
own SHA-256 manifest; it is a demonstration, not additional qualification.
Earlier native migration evidence below retains its source and artifact identities.

## Validation and known gaps

The local macOS arm64 qualification passed 113 portable/native CAD contract
tests and 62 default Rust tests. The separate CAD contact-witness test passed
with its local geometry fixture. The clean exported source installed its VSIX
into stock VS Code 1.105.1 and exercised native modeling, cache reopening, error
recovery, captures and runtime repair. The WPILib 2026.2.1 companion stack also
passed with the full packaged robot, 1,958-part cached CAD view, real Java/Phoenix
controls, simulation rendering/capture, and clean shutdown. Evidence:
[clean source](release-evidence/macos-source.json),
[full installed example](release-evidence/macos-wpilib.json).

The training example independently built with GradleRIO 2026.2.1 and Phoenix
26.1.3 and passed its CLI robot/season integration contract. The field's 6,186
occurrence placements matched the prior importer to within 1.2e-16 in matrix
entries; the 51 multicolor occurrences and 33-color palette were retained.
These are functional checks, not a hardware-accuracy or real-time guarantee.

GitHub CI passed clean-source builds, native tests, relocated runtime tests and
installed stock-editor checks on macOS and Linux:
[CI run](https://github.com/gfleming1992/CadCove-FRC/actions/runs/39075403389),
[Linux evidence](release-evidence/linux-ci.json),
[macOS CI evidence](release-evidence/macos-ci.json). CI uses software GPU rendering;
it does not measure hardware GPU performance or run the full vendor team program. Windows is intentionally untested for this candidate; the
maintainer will perform the Windows check after downloading the source release.
A package build alone is not platform qualification.

Native migration evidence lives in
[the geometry report](../examples/team3310-rebuilt/source/native-migration-validation.json).
Two rails have known STEP round-trip validity limitations despite valid native
BREPs; see [the native model notes](../examples/team3310-rebuilt/source/cad-assets/robot/native/README.md).
One imported field quick-release pin has unresolved BREP validity after repair;
it remains an imported mesh and is not evidence of a manufacturing-ready solid.

The launch film uses actual editor and simulation captures, edited and retimed.
Camera cuts and faster playback are presentation edits, not runtime performance
measurements or a single continuous match. Music is an original synthesized
score. No commercial music is redistributed with the release.
