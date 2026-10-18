# CadCove-FRC

**CAD, robot code and physics simulation together in VS Code/WPILib.**

Use your existing AI coding agent—Codex, Claude or Copilot—to design parts,
work on robot code and test changes in a local simulator. CadCove is MIT open
source and includes Team 3310’s Amarillo robot as a complete example.

[Watch the 60-second demo](https://youtu.be/5UMsJ54wpM8) ·
[Install from Marketplace](https://marketplace.visualstudio.com/items?itemName=gfleming1992.cadcove-toolbox) ·
[Installation guide](docs/INSTALL.md)

## What you can do

- **Design and inspect CAD:** edit Python/CadQuery models or import STEP from
  Onshape/SolidWorks. View colored assemblies, pan, zoom and orbit in WebGPU.
- **Work with your agent:** build models, inspect exact geometry, capture views
  and fix errors through the CLI. Workspace setup adds guidance for your agent.
- **Test robot code:** connect Java/WPILib and supported Phoenix 6 devices to
  native Rust/Rapier physics, including simulated sensor feedback.
- **Drive and experiment:** use live gameplay mode for practice or a more detailed
  simulation profile for background checks. Robot and field configurations are
  replaceable.

CAD edits reuse cached components and preserve the camera. Your CAD, code and
simulation configuration live in your project. CadCove requires no separate AI
account or API key.

## Get started

1. Install [CadCove FRC from Marketplace](https://marketplace.visualstudio.com/items?itemName=gfleming1992.cadcove-toolbox).
   VS Code selects the package for your system. Offline VSIX packages are also in
   [Releases](https://github.com/gfleming1992/CadCove-FRC/releases).
2. Install **Bun 1.4.2** and **Python 3.12 with the pinned CadQuery dependencies**.
   Follow the [installation guide](docs/INSTALL.md) to configure Python.
   Robot simulation also needs WPILib 2026 and the team’s vendor libraries.
3. Open your robot project in VS Code or WPILib VS Code and run
   **CadCove: Initialize Team Workspace**.
4. Start a new conversation with your coding agent. Right-click a Python model
   or STEP file and choose **Open in CAD Canvas**.

The extension includes the native runtime; Rust is only needed to build from
source. See the [agent quickstart](docs/AGENT-QUICKSTART.md) for a first task.

## Try our Team 3310 robot

The repository includes Amarillo’s CAD, robot code and simulation bindings.
The generic VSIX contains the tools and a small training fixture; prepare the
full team example from a repository checkout:

```sh
bun install --frozen-lockfile
bun run example:team --output ../Amarillo-REBUILT
```

Setup downloads the REBUILT field from FIRST and builds the robot with your
installed WPILib toolchain. The first run needs internet and may take several
minutes. Open the resulting folder and run **CadCove: Open Robot CAD** or
**CadCove: Open Live Simulation**.

[Example setup](examples/team3310-rebuilt/README.md) ·
[Driver Station and controllers](docs/DRIVER-STATION.md)

## Working with your own robot

Keep reusable parts in Python modules and vendor components as STEP files.
Connect motors, sensors and mechanisms through the
[robot integration guide](docs/ROBOT-PROJECTS.md). CAD cannot supply every physical
parameter: review gearing, mass, friction and simulation bindings against your
robot. Simulation complements physical testing.

Use **CadCove: Update Agent Guidance** after an upgrade to refresh the agent
instructions while preserving team customizations.

## Documentation

- [System card: how it works and practical limits](docs/SYSTEM-CARD.md)
- [CAD authoring workflow](agent-skills/references/cad-authoring.md)
- [FRC workflows and season knowledge](docs/FRC-AGENT-WORKFLOW.md)
- [Device adapters](docs/DEVICE-ADAPTERS.md) and [simulation modes](docs/SIMULATION-MODES.md)
- [Contributing and building from source](CONTRIBUTING.md)

Report bugs and setup issues through
[GitHub Issues](https://github.com/gfleming1992/CadCove-FRC/issues).

## License

Original CadCove code is [MIT licensed](LICENSE). Dependencies, team assets and
FIRST content retain their own terms; see [license details](licenses/README.md).
