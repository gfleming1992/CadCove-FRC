# CadCove-FRC — system card

## What it does

CadCove-FRC brings CAD, robot code and physics simulation into VS Code and
WPILib VS Code. Teams keep their models, code and simulation settings in one
repository and work with their existing coding agent, such as Codex, Claude or
Copilot. CadCove is local and MIT open source; it requires no CadCove account or
AI API key.

## How it works

| Component | What it does |
| --- | --- |
| Python / CadQuery / native OCCT | Builds editable parts and assemblies, imports STEP, checks geometry and exports models |
| WebGPU viewer | Displays colored CAD inside VS Code with pan, zoom, orbit and image capture |
| Java / WPILib / Phoenix 6 integration | Connects the team's robot program to simulated motors and sensors |
| Native Rust / Rapier | Simulates motion, contacts, mechanisms and field interactions on the local CPU |
| Agent tools | Build, inspect, capture and test through files and a CLI; MCP is also available |

CAD modeling and physics run on your computer. The VS Code webview displays
the scene. Robot and season configurations are replaceable.

## Typical workflow

1. Install the extension and dependencies using the [installation guide](INSTALL.md).
2. Initialize a team workspace to add guidance for your coding agent.
3. Ask the agent to create or edit a Python model, or import existing STEP parts.
4. Open the model in the CAD canvas. The agent can inspect dimensions, check
   geometry and capture views to review its work.
5. Connect the robot code, motors, sensors and mechanisms to the simulation.
6. Test changes through live driving or automated runs, then review the results.

Edits reuse cached components and preserve the camera. Cached models can reopen
without rebuilding their geometry. If a build fails, the viewer keeps the last
successful scene and reports the error.

See the [agent quickstart](AGENT-QUICKSTART.md) and
[robot integration guide](ROBOT-PROJECTS.md) for details.

## Included example

The main example is **Team 3310's Amarillo robot**, with editable CadQuery parts,
vendor STEP components, robot code and simulation bindings. Setup downloads the
REBUILT field from FIRST. The robot and field can be replaced for your own team
and season. See [example setup](../examples/team3310-rebuilt/README.md).

## Simulation modes and practical limits

- **Gameplay:** prioritizes responsive driving with simplified contact behavior.
- **Detailed simulation:** retains more contact detail and may run slower than
  real time. The viewer shows how quickly the simulation is advancing.

CAD alone does not specify motor IDs, gearing, mass, friction or control behavior.
Teams must review those settings and calibrate them against their robot. Supported
WPILib/Phoenix devices have adapters; other devices may need integration work.
Simulated Limelight observations are approximations.

Performance depends on your CPU, scene complexity and the number of active
contacts. Simulation helps test ideas and code; physical robot testing and safety
checks are still required. The edited launch video is a demonstration, not a
real-time performance measurement.

Two example rails have known STEP export/reimport limitations, and one imported
field pin has unresolved solid validity. Check exported geometry before using it
for manufacturing. See [geometry notes](../examples/team3310-rebuilt/source/cad-assets/robot/native/README.md)
and the [validation report](../examples/team3310-rebuilt/source/native-migration-validation.json).

## Requirements, privacy and licensing

Use the package for your operating system and CPU architecture. Python/CadQuery
and Bun are installed separately; running robot code also requires WPILib and
matching vendor dependencies. Exact versions and setup are in the
[installation guide](INSTALL.md). Consult the
[release notes](https://github.com/gfleming1992/CadCove-FRC/releases) for each
package's tested platforms and known issues.

Only open trusted projects: Python CAD and robot programs execute with your user
permissions. Your chosen AI agent may send code or captures to its provider under
its own settings. Keep credentials and private season materials out of Git.

Original CadCove code is MIT licensed. Dependencies, team assets and FIRST content
retain their own terms; see [license details](../licenses/README.md).

## Engineering details

For contributors: [release checks](TOOLBOX-RELEASE.md),
[test reports](release-evidence/), and
[CAD performance measurements](NATIVE-CADQUERY-PROFILE.md).
