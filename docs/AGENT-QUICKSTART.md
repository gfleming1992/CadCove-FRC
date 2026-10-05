# Start with your existing editor agent

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


## Install once per robot workspace

1. Install the VSIX matching the local machine in VS Code or WPILib VS Code.
   Current local qualification is macOS arm64; check release evidence for other platforms.
2. Open the **robot repository root** as a trusted local workspace. CAD may be a
   subfolder; the source/build folders are configured in `.cadcove/project.json`.
3. Run **CadCove: Initialize Team Workspace**. It creates shared local guidance,
   six focused FRC workflows, pinned brepjs API references, a season descriptor
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
> design intent. Check cad-status and inspect cad-preview after building.

Open **CadCove: Open in CAD Canvas** before asking for build feedback. CAD runs without
Java/vendor integration. The viewer executes plain JavaScript through brepjs and
OCCT-WASM; there is no modeling DSL or TypeScript compilation in a robot project.

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
