# CadCove-FRC

Native Python/CadQuery is the default for new CAD projects. Agents edit source
and use `cadcove cad-build`, `cad-session`, `cad-inspect`, `cad-export` and
`cad-capture`. Right-click Python/STEP files to open the interactive WebGPU
canvas in VS Code. See [the authoring workflow](agent-skills/references/cad-authoring.md)
and [measured native performance](docs/NATIVE-CADQUERY-PROFILE.md).

The bundled Team 3310 robot now uses `models.py`: all **109 authored designs**
are native CadQuery, with **320 retained STEP assets** and **1,958 occurrences**.
The viewer remains WebGPU. See the [migration evidence](examples/team3310-rebuilt/source/native-migration-validation.json)
and [rail STEP exchange limitation](examples/team3310-rebuilt/source/cad-assets/robot/native/README.md#known-rail-step-exchange-limitation).

Part of **CadCove**: an MIT open-source monorepo for agent-assisted CAD,
robot code, and local FRC simulation.

**Source release:** build instructions are below. Public prebuilt VSIX releases
are not available yet. The Team 3310 robot CAD, code and simulation bindings
are included. Setup downloads REBUILT field geometry directly from FIRST and
builds the robot with your installed WPILib toolchain.

## Agent workflow: files and CLI

Use **CadCove: Open Toolbox Terminal** for the packaged CLI. New projects select
`models.py`; configure a Python 3.12 environment with the shipped pinned
`cad-requirements.txt`, then set `CADCOVE_PYTHON` or project `pythonPath` and the
editor's `instantcad.pythonPath` to that interpreter. Python dependencies are
installed explicitly, not downloaded when opening a model.

```sh
cadcove cad-build --workspace .
cadcove cad-inspect --workspace . --script checks.py
cadcove cad-export --workspace . --output build/robot.step
cadcove cad-capture --workspace . --view iso --ids bracket --output build/bracket.png
```

Build, inspect and export work without VS Code. Capture requires the model open
in the editor's WebGPU canvas; it fits the requested parts without changing the
user's camera. For repeated iterations use `cad-session` and JSONL requests to
keep one native worker warm. Errors and revisions are structured, so agents can
repair source from measured feedback. MCP remains an optional compatibility
bridge; agent setup does not require enabling tools or a hosted API.

Use **CadCove: Update Agent Guidance** after upgrading. Team edits are preserved.

Local CAD, robot-code integration, and native FRC simulation in one VS Code
extension. Use your own Codex, Claude Code, Copilot, or filesystem agent. CadCove adds no
AI chat box, API key, or cloud account requirement.

Original CadCove code and its included generic CAD core are [MIT licensed](LICENSE).
Third-party dependencies retain their own licenses; see [dependency notices](licenses/README.md).
This is independent of the NativeCAD application: CAD uses local Python/CadQuery and native OCCT exclusively. It does not use NativeCAD's
server, native OCCT worker, custom command language, API keys or services.
The native Rust process runs Rapier physics independently of Python CAD modeling.

**Development candidate — not a production release yet.** macOS arm64 has passed
installed-extension CAD, native simulation, live viewing, agent capture and
runtime-repair checks, including the WPILib 2026.2.1 editor stack. Linux and macOS
CI pass clean-source builds and installed stock-editor checks. Windows testing,
hardware qualification and binary redistribution review remain open. The original
code is MIT; this does not relicense dependencies or team/season assets.
See the [system card and test evidence](docs/SYSTEM-CARD.md) and
[remaining release gates](docs/TOOLBOX-RELEASE.md).

## Student workflow

The main detailed example is [the team's Amarillo robot on REBUILT](examples/team3310-rebuilt/README.md),
kept as a separate content pack with independently replaceable robot and field.
See [FRC agent workflows and season knowledge](docs/FRC-AGENT-WORKFLOW.md) for
vendor-aware CAD/code skills and private, page-cited manual imports.

1. Install the platform toolbox VSIX in a local VS Code/WPILib workspace.
2. Run **CadCove: Initialize Team Workspace**, then **Open Toolbox Terminal**.
3. Start a **new agent conversation** in that workspace. Initialization adds
   `AGENTS.md` (Codex), `CLAUDE.md` (Claude Code) and
   `.github/copilot-instructions.md` (Copilot), preserving existing instructions.
   All point to `.cadcove/AGENT.md`. No manual copying of a `.github` folder is
   required. Use the [agent quickstart](docs/AGENT-QUICKSTART.md) to verify discovery.
4. Author CAD Python under the configured source folder and open it with
   **CadCove: Open in CAD Canvas**. File edits rebuild the model; the CLI supplies
   revision-checked status and PNG previews for agent feedback.
5. Integrate the robot's Java/WPILib program, native world and CAD bindings using
   the [device guide](docs/DEVICE-ADAPTERS.md). Run and inspect it with `cadcove
   sim-run`, `sim-state`, `sim-objects`, `sim-controls` and `sim-capture`.
6. Open Live Simulation for driving practice. The viewer uses the same CAD
   renderer and native physics as agent-driven runs. Driver Station owns live inputs.

The extension ships verified platform executables; users do not need Rust or
Bun to run them. Robot simulation additionally needs the team's WPILib JDK,
compiled robot program and compatible desktop vendor libraries. CAD by itself
does not identify actuator wiring, gear ratios, masses, friction or control
semantics: integration and physical calibration must be explicit.

Before launching a robot program, `cadcove sim-validate --project robot.sim.json`
checks the compiled artifacts and loads the world in a temporary native process.
It reports shape, joint, motor and collision-asset errors without Java/Phoenix
startup. It exits at tick zero and leaves existing sessions alone. Passing this
check does not establish dynamic stability, device integration or calibration.
Native loading can populate the project's cooked collision cache; `doctor` and
`audit` remain the checks that do not execute the engine.
Initialization also installs a physics authoring reference and a synthetic
mechanism example under `.cadcove/skills/references/`. These explain the native
units, collision formats, joints/motors, and occurrence bindings. Example values
are illustrative, not vendor specifications or tuning for the team's robot.

CAD source and build folders can live inside a larger robot-code workspace.
The canvas shows only the scene and physics real-time percentage.
Imports, configuration and robot/season customization are files that agents can
edit. No robot program or field CAD is downloaded implicitly.

After a toolbox upgrade, use **CadCove: Update Agent Guidance** or run `cadcove guidance-update --workspace . --dry-run`
to review instruction/skill changes. Unedited generated guidance can update
automatically; team edits receive proposals for the agent to merge. Missing agent
entry blocks are added without replacing existing root instructions.

### Play the team robot

The main example is Team 3310's Amarillo: 1,958 CAD occurrences, 109 authored
part designs, retained STEP parts, the actual Java/Phoenix robot program,
and the reviewed gameplay world and intake alignment. Robot source lives in
[examples/team3310-rebuilt/source](examples/team3310-rebuilt/source).

Install Bun and the WPILib 2026 toolchain/JDK, then run from this repository:

```sh
bun install --frozen-lockfile
bun run example:team --output ../Amarillo-REBUILT
```

Setup downloads the checksum-pinned field directly from FIRST, rebuilds colored
field meshes and collision data, adds agent guidance, then uses Gradle to build
the robot JAR and obtain the current platform's vendor libraries. The first run
needs internet and may take several minutes. It creates a new folder and never
overwrites an existing project. Open that folder in VS Code/WPILib with the
CadCove extension installed; run **CadCove: Open Robot CAD** or **Open Live Simulation**.
Map controllers in WPILib Sim GUI (driver port 1, operator port 0), then enable
Teleoperated. See [Driver Station setup](docs/DRIVER-STATION.md).

Use `--skip-robot-build` for CAD/artifact preparation without Java; simulation
then requires the documented robot build. Use `--field-step /path/to/field.step`
for an already downloaded, matching official field. See the
[example setup guide](examples/team3310-rebuilt/README.md) for details and licenses.
A locally built Team Robot edition can still package the prepared workspace with
`scripts/package-runtime.js --team-example /path/to/Amarillo-REBUILT`.
The installed `example-create` command consumes that pack; a generic runtime
without it uses the source setup above. Generated FIRST assets stay local.

The small `training-robot` remains available for fast independent contract tests.

## Live practice and detailed simulation

Both use the same native physics process and actual robot program. Practice may
use explicitly authored approximations to meet interactive deadlines. Detailed
profiles preserve the original world for slower background checks. They use
separate builds and fresh sessions; detailed does not mean hardware certified.
See [selecting and validating modes](docs/SIMULATION-MODES.md).

## Architecture and integration

- `vendor/cad-core`: hash-verified export of the independent CAD core, shared
  with the browser app. Generic changes are made upstream and repinned.
- `extensions/vscode`: editor wrapper and verified runtime installation/repair.
- `bin/cadcove.js`, `lib`: portable CLI, project audit, managed sessions and
  authenticated local viewer/control clients.
- `crates/sim-core`: native Rust physics using pinned Rapier/Parry sources and
  documented local corrections/optimizations.
- `bridge/java`: robot-side device feedback, DriverStation controls, synthetic
  vision and season observer APIs, compiled against the team's own libraries.
- `examples/season-plugin`: independent training rules demonstrating the
  [season extension contract](docs/SEASON-PLUGINS.md).
- `examples/training-robot`: an [original runnable example](examples/training-robot/README.md)
  with real Phoenix 6 TalonFX/CANcoder/Pigeon2 interfaces, the official Limelight
  helper, authored CAD and a separate training season. Its explicit mechanical
  assumptions are not a claim of hardware calibration.

Motor controllers can implement `MotorAdapter`; supported CTRE devices have
an included adapter. Limelight observations use the team's NetworkTables/parser
interface, with explicit modeled noise and delay. Neither that model nor a
successful simulation is a claim of hardware qualification. Detailed physics and
faster gameplay approximations are declared separately in project metadata.

## Build and verify a candidate

Development needs Bun 1.4.2, Rust 1.91.1, Python 3.12 with the pinned
CadQuery requirements, and the appropriate native build toolchain.
[Windows verification instructions](docs/WINDOWS-CHECK.md) are provided for the
maintainer; Windows is deliberately not qualified by this candidate.
This source tree includes the pinned generic core; no sibling checkout or team
robot submodule is needed for the toolbox build and asset-free test suite.

```sh
python3.12 -m venv .venv-cadquery
.venv-cadquery/bin/python -m pip install -r vendor/cad-core/src/native/requirements.txt
export CADCOVE_PYTHON="$PWD/.venv-cadquery/bin/python"
bun install --frozen-lockfile
bun run test:toolbox
bun scripts/build-native-runtime.js
# Windows native output ends in .exe.
bun scripts/package-runtime.js --native-binary target/distribution/release/instantcad-sim \
  --output artifacts/runtime-candidate --version 0.2.0-native-preview \
  --base-url https://YOUR-RELEASE-HOST/RELEASE/TARGET
bun tests/packaged-runtime.js artifacts/runtime-candidate
bun scripts/build-toolbox-extension.js --runtime artifacts/runtime-candidate
```

Package the staged extension with the checked packager (substitute its platform
and architecture):

```sh
bun scripts/package-toolbox-extension.js \
  --extension build/toolbox-extension-darwin-arm64 \
  --output artifacts/cadcove-toolbox-development.vsix --development
```

This verifies required VSIX contents and runtime/kernel provenance. Production
publishing requires resolved license/repository metadata and
platform qualification; development flags that skip those gates are not release
approval. See `extensions/vscode/README.md` for runtime repair and terminal PATH
behavior. Exported Java source updates are reviewed explicitly and never replace
team customizations automatically.

The public-source CI also installs the generated VSIX into a separate editor
profile and exercises CAD builds, edits, cache reuse, preview feedback, runtime
repair and the bundled example. To run that gate locally from a committed tree:

```sh
CADCOVE_TEST_EDITOR_VERSION=1.105.1 \
  bun scripts/verify-toolbox-source.js --output /path/to/new-source-check --editor
```

It downloads the pinned stock editor using Microsoft's test helper. CI uses
`CADCOVE_TEST_SOFTWARE_GPU=1` for SwiftShader and Xvfb on Linux; this checks
functionality, not hardware rendering speed. Reports bind results to the source
revision and VSIX hash. WPILib companion extensions and actual vendor robot
execution remain separate qualification runs.

## Contributing and publishing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development, tests and agent guidance,
[SECURITY.md](SECURITY.md) for the local execution boundary, and
[release checklist](docs/TOOLBOX-RELEASE.md) for source versus binary release gates.
GitHub source publication and Marketplace publication are separate steps.

## Public source boundary

`config/toolbox-source.json` defines the source distribution. From a committed
checkout, `bun scripts/export-toolbox-source.js --output NEW_DIRECTORY` exports
only approved tracked files, with per-file hashes and source revision. It omits
unapproved team fixtures, FIRST field geometry/manuals, recordings, profiles, local credentials, development assets,
benchmark experiments and repository history. The development checkout keeps
those fixtures separately for engineering evidence; they are not required to
build the exported toolbox. This export is a reviewable candidate, not a license
or publication assertion.

The library list is explicit: adding a new shipped module also requires updating
the source policy. Team-specific field/shooter extraction and profiling helpers
are outside that list. Run the fresh-source verifier after changing this boundary
so a working development checkout cannot hide a missing release dependency.
