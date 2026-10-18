# Start with your existing editor agent

## Files and command-line feedback

Agents use the CLI and filesystem. Start with `.cadcove/AGENT.md`, then the
native CadQuery authoring reference. Run `cadcove cad-build`, inspect with
`cad-inspect --script checks.py`, and keep `cad-session` warm for iterations.
Right-click a Python/STEP file to open the model in VS Code. Use `cad-capture`
for focused images from that WebGPU canvas. Neither CAD build nor exact
inspection requires an editor window or an MCP tool registration.

## Install once per robot workspace

1. Install [CadCove FRC from Marketplace](https://marketplace.visualstudio.com/items?itemName=gfleming1992.cadcove-toolbox)
   in VS Code or WPILib VS Code. Follow [installation](INSTALL.md) to set up
   Bun 1.4.2 and Python/CadQuery. VS Code selects the native package for your system.
2. Open the **robot repository root** as a trusted local workspace. CAD may be a
   subfolder; the source/build folders are configured in `.cadcove/project.json`.
3. Run **CadCove: Initialize Team Workspace**. It creates shared local guidance,
   six focused FRC workflows, native CadQuery API guidance, a season descriptor
   and an unintegrated simulation manifest. It preserves existing robot source.
4. Open **CadCove: Open Toolbox Terminal**; run `cadcove capabilities`.
5. Start a new Codex, Claude Code or Copilot agent conversation in this workspace.
   Existing agent terminals may need restarting to inherit the CLI PATH.

| Agent | Automatically discovered repository entry |
| --- | --- |
| Codex | `AGENTS.md` |
| Claude Code | `CLAUDE.md` |
| GitHub Copilot in VS Code | `.github/copilot-instructions.md` |

Each entry points to `.cadcove/AGENT.md`; it routes to focused files under
`.cadcove/skills/`. These are ordinary files read on demand, not registrations in
three separate agent marketplaces. Keep repository instructions enabled in the
agent. Nested or overriding instructions can change discovery. The extension
cannot guarantee that every agent follows instructions or sees an already-open
session's newly written files.

Official discovery references: [Codex](https://developers.openai.com/codex/guides/agents-md),
[Claude Code](https://code.claude.com/docs/en/memory),
[Copilot](https://docs.github.com/en/copilot/reference/custom-instructions-support).

## Verify discovery before designing

Ask:

> Read this workspace's CadCove instructions. Run `cadcove capabilities`, identify
> the CAD entry, selected simulation manifest and season, then report which
> integration inputs are missing. Do not change robot code yet.

The agent should find `.cadcove/AGENT.md` without searching another repository.
If it does not, explicitly point it there once and check the entry file, active
workspace, instruction settings and terminal PATH. In a multi-root workspace,
select a file in the desired robot folder before invoking extension commands.

## First CAD task

> Create an editable swerve chassis concept in the configured CAD entry. Reuse
> our available modules; ask for dimensions or exact variants that are missing.
> Use stable part IDs, separate reusable components, colors and comments about
> design intent. Build with cad-build, check exact geometry with cad-inspect,
> and inspect a focused cad-capture before accepting the change.

Build and inspect from the CLI without opening the editor. Right-click the Python
or STEP file and choose **CadCove: Open in CAD Canvas** for interactive viewing
and `cad-capture`. New projects execute ordinary Python with native CadQuery/OCCT;
the WebGPU canvas is a VS Code webview. CAD runs without Java/vendor integration.

## Connect code and run

> Read our WPILib subsystems, vendordeps, CAD and selected season. Inventory the
> real CTRE devices, Limelight configuration, motors and mechanisms. Integrate
> desktop simulation while preserving hardware behavior. Record unknown
> measurements, run audit and sim-validate, then test motor signs and sensors
> before driving. Show revision-matched telemetry and a scene capture.

Use the [device contract](DEVICE-ADAPTERS.md) and
[simulation modes](SIMULATION-MODES.md). The bridge supports Java/WPILib with the
listed Phoenix 6 devices and modeled Limelight observations. Generic STEP files
cannot establish wiring, ratios, inertia, friction or control behavior. An agent
must bind and validate these explicitly. There is no promise of zero-touch robot
integration or automatic mechanism inference.

## What belongs in Git

Commit CAD/robot source, authored physical configuration, calibration evidence,
agent entry files, `.cadcove/AGENT.md`, skills, project/frc settings and guidance
baseline. Ignore the configured generated build directory (default
`/build/cadcove/`), `.cadcove/guidance-updates/`, runtime caches and imported
`.cadcove/knowledge/` PDFs/text. Session files contain local control credentials.
The importer already creates an ignore file for private season knowledge. Review
team CAD/vendor redistribution rights before sharing a project.

## Upgrade without losing team knowledge

Use **CadCove: Update Agent Guidance**, or:

```sh
cadcove guidance-update --workspace . --dry-run
cadcove guidance-update --workspace .
```

Missing discovery blocks are appended; existing blocks are not replaced. Edited
or deliberately deleted generated guidance yields review proposals and exit 1.
Merge team knowledge, inspect reported conflicts, and start a new agent session.
Bridge source upgrades are separate: `cadcove bridge-export --workspace . --review`.
