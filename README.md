# CadCove-FRC

Part of **CadCove**: an MIT open-source monorepo for agent-assisted CAD,
robot code, and local FRC simulation.

**Source release:** build instructions are below. Public prebuilt VSIX releases
are not available yet; the Team Robot content pack described below is a local
example and is not included in this repository. The original training example
is included.

## Agent tools start with the editor

In a trusted CadCove workspace, the extension starts an authenticated local MCP
server and advertises **CadCove** to VS Code's agent tool picker. Enable it there
and approve the editor's normal tool-access prompt if asked. “Open robot CAD”
uses `open_robot_cad` directly; it does not need a repository scan or simulation
startup. `workspace_context`, `cad_status`, `capture_scene`, `set_camera`, and
simulation tools provide structured feedback. Edit source with normal editor tools.

For other local MCP-capable agents, configure a stdio server with command
`cadcove`, arguments `["mcp", "--workspace", "/absolute/path/to/robot-project"]`.
Use the CLI path from a new **CadCove: Open Toolbox Terminal** if it is not on
PATH. Keep that workspace open in VS Code. The bridge reads a private generated
endpoint descriptor under the configured build folder; never commit it or copy
its token into agent prompts. A workspace reload requires reconnecting the agent
MCP server. No remote service or AI API key is needed.

Use **CadCove: Update Agent Guidance** once in existing projects, then start a
new agent conversation so its discovery instructions are current. Team edits are
preserved. Server availability alone cannot force an agent to use a tool; the
workspace guidance directs simple open requests to the tool immediately.


Local CAD, robot-code integration, and native FRC simulation in one VS Code
extension. Use your own Codex, Claude Code, Copilot, or filesystem agent. CadCove adds no
AI chat box, API key, or cloud account requirement.

Original CadCove code and its included generic CAD core are [MIT licensed](LICENSE).
Third-party dependencies retain their own licenses; see [dependency notices](licenses/README.md).
This is independent of the NativeCAD application: CAD is JavaScript through
brepjs and OCCT-WASM inside the viewer worker. It does not use NativeCAD's
server, native OCCT worker, custom command language, API keys or services.
The included native Rust process runs physics, not CAD modeling.

**Development candidate — not a production release yet.** macOS arm64 has passed
installed-extension CAD, native simulation, live viewing, agent capture and
runtime-repair checks, including the WPILib 2026.2.1 editor stack. Windows/Linux,
hardware qualification and binary redistribution review remain open. The original
code is MIT; this does not relicense dependencies or team/season assets.
See the [release evidence and remaining gates](docs/TOOLBOX-RELEASE.md).

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
4. Author CAD JavaScript under the configured source folder and open it with
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

Install the **Team Robot edition** VSIX for your platform and the WPILib 2026
JDK. Run **CadCove: Play Team Robot Example** from the Command Palette. Choose a
new workspace folder; CadCove copies Team 3310's Amarillo robot, the REBUILT field,
actual Java/Phoenix program, and matching native vendor libraries, then opens the
workspace, live simulator and WPILib Sim GUI. Map plugged-in controllers to
driver port 1 and operator port 0, enable Xbox mapping, then select Teleoperated
in Sim GUI. See [Driver Station setup](docs/DRIVER-STATION.md). No robot-code build is required to
try the packaged example. Invoking the command again inside that example reopens
its simulator without making another copy.

Agents can create the same workspace with:

```sh
cadcove example-create --workspace /path/to/new-team-robot
```

The default is `team3310-rebuilt`. Source CAD, robot code and agent guidance are
included for editing. Rebuild the robot JAR after code changes. Mass, friction
and sensor calibration remain provisional. The platform content pack is separate
from the generic MIT source and retains team/FIRST/vendor ownership; the current
team edition is a local distribution, not a cleared public asset release.

The small `--example training-robot` remains available explicitly for lightweight
contract tests. It is not the primary robot demonstration.

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

Development needs Bun, Rust/Cargo and the appropriate native build toolchain.
This source tree includes the pinned generic core; no sibling checkout or team
robot submodule is needed for the toolbox build and asset-free test suite.

```sh
bun install --frozen-lockfile
bun run test:toolbox
bun scripts/build-native-runtime.js
# Windows native output ends in .exe.
bun scripts/package-runtime.js --native-binary target/distribution/release/instantcad-sim \
  --output artifacts/runtime-candidate --version 0.1.0-dev \
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
team robot code/CAD, recordings, profiles, local credentials, development assets,
benchmark experiments and repository history. The development checkout keeps
those fixtures separately for engineering evidence; they are not required to
build the exported toolbox. This export is a reviewable candidate, not a license
or publication assertion.

The library list is explicit: adding a new shipped module also requires updating
the source policy. Team-specific field/shooter extraction and profiling helpers
are outside that list. Run the fresh-source verifier after changing this boundary
so a working development checkout cannot hide a missing release dependency.
