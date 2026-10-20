# CadCove FRC

**CAD, robot code and physics simulation in VS Code/WPILib.**

Work with Codex, Claude, Copilot or your preferred coding agent to create parts,
edit robot code and test it in a local simulator.

[Watch the demo](https://youtu.be/5UMsJ54wpM8) ·
[Setup guide](https://github.com/gfleming1992/CadCove-FRC/blob/main/docs/INSTALL.md) ·
[Source code](https://github.com/gfleming1992/CadCove-FRC)

## Features

- Editable Python/CadQuery models and STEP imports from Onshape/SolidWorks.
- Interactive, colored WebGPU assemblies with pan, zoom and orbit.
- Cached reopening and component updates that preserve your camera.
- Agent tools for building, inspecting, capturing and exporting CAD.
- Native Rust/Rapier simulation with Java/WPILib/Phoenix integration.
- Live driving and more detailed simulation profiles.

## Get started

1. Install **Bun 1.4.2** and **Python 3.12** with the pinned CadQuery dependencies
   in the [setup guide](https://github.com/gfleming1992/CadCove-FRC/blob/main/docs/INSTALL.md).
2. Set **instantcad.pythonPath** to that Python environment's executable and
   restart VS Code after installing dependencies.
3. Open a trusted local project and run **CadCove: Initialize Team Workspace**.
4. Start a new agent conversation. Setup creates guidance for Codex, Claude and
   Copilot while preserving existing team instructions.
5. Right-click a `.py`, `.step` or `.stp` file and select
   **CadCove: Open in CAD Canvas**.

Orbit with left-drag, pan with right/middle or Shift-drag, zoom with the wheel,
and press **F** to fit the model.

Use **CadCove: Open Toolbox Terminal** for CLI tools. MCP tools are also available
in a trusted, open workspace. CadCove requires no separate AI account or API key.

## Try Team 3310's Amarillo robot

The repository includes the robot's CAD, code and simulation bindings. Follow
[the example setup](https://github.com/gfleming1992/CadCove-FRC/blob/main/examples/team3310-rebuilt/README.md)
to download the REBUILT field and build the robot with your WPILib installation.
The extension itself includes the tools and a small training fixture.

For an integrated project, run **CadCove: Start Robot Simulation** followed by
**CadCove: Open Live Simulation**. Configure controllers and enable Teleoperated
in WPILib Sim GUI. See
[Driver Station setup](https://github.com/gfleming1992/CadCove-FRC/blob/main/docs/DRIVER-STATION.md).

## Project setup and updates

Configure CAD source/build folders and the Python entry in `.cadcove/project.json`.
Run **CadCove: Update Agent Guidance** after upgrading. Use
**CadCove: Check Project** for configuration diagnostics and
**CadCove: Repair Runtime** to restore the bundled runtime.

Robot simulation requires WPILib and matching desktop vendor libraries. Review
mechanism bindings and physical parameters for your robot; simulation complements
physical testing. Python models and robot programs run with your local permissions,
so only open trusted projects.

[Agent quickstart](https://github.com/gfleming1992/CadCove-FRC/blob/main/docs/AGENT-QUICKSTART.md) ·
[System card](https://github.com/gfleming1992/CadCove-FRC/blob/main/docs/SYSTEM-CARD.md) ·
[Report an issue](https://github.com/gfleming1992/CadCove-FRC/issues)

Original CadCove code is MIT licensed. Dependencies and robot/season assets retain
their own terms. [License details](https://github.com/gfleming1992/CadCove-FRC/blob/main/licenses/README.md).

### Canvas marker

Drag the middle mouse button to draw red marker strokes. Multiple strokes stay
visible together until you orbit, pan, zoom, fit, resize, or replace the model.
Right drag still pans; left drag orbits. Press Escape to clear marks manually.
Marks are temporary screen-space notes; they do not modify geometry or appear
in CAD exports or cached previews.
