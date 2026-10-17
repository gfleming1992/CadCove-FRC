# CadCove Toolbox — development candidate

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


A single editor wrapper for the shared local CAD core and native simulation
toolbox. Use your existing Codex, Claude Code, Copilot, or command-line agent; no AI account,
API key, or embedded chat box is added by this extension.

1. Open a trusted local WPILib workspace.
2. Run **CadCove: Initialize Team Workspace**. This installs/verifies the bundled
   platform runtime and creates agent instructions without replacing robot code.
3. Open **CadCove: Open Toolbox Terminal** to use `cadcove help`. New editor
   terminals also receive the runtime on PATH. An already-running agent may need
   a new terminal or its session restarted to inherit the PATH addition.
4. Start a new agent conversation. Initialization adds `AGENTS.md`, `CLAUDE.md`
   and `.github/copilot-instructions.md`, each pointing at `.cadcove/AGENT.md`.
   Existing team instructions are preserved. Ask the agent to read that guide and
   author the Python entry configured in `.cadcove/project.json` (initially
   `cad/models.py`). Install Python 3.12 with the pinned `cad-requirements.txt`
   and set `instantcad.pythonPath` to that interpreter. Initialization installs
   native CadQuery authoring, inspection and capture guidance. CAD can run before
   Java/vendor dependencies and simulation integration are configured.
5. Run **CadCove: Open in CAD Canvas**. Edits rebuild automatically. Orbit with left
   drag, pan with right/middle or Shift-drag, zoom with the wheel, and press F to
   fit. Build diagnostics and preview images are written under the configured
   build directory's `cad-cache/<entry>/` folder.

Agents can use `cadcove cad-status --workspace .` and
`cadcove cad-preview --workspace .` to get JSON feedback. These commands reject
stale source revisions; preview lookup also checks the PNG digest before
returning its path. The preview represents the last build, not subsequent camera
movements.

For an integrated robot, **CadCove: Start Robot Simulation** runs the packaged
CLI as a local editor task; **Stop Robot Simulation** shuts it down. Agents can
also use `cadcove sim-run`, `sim-state`, `sim-objects`, `sim-controls`, and
`sim-stop` with an explicit `--project` manifest. Read `.cadcove/AGENT.md` for
bridge export, device integration, input leases, and calibration requirements.
`simulationProject` in `.cadcove/project.json` may point to a subfolder manifest.
Starting a task is not confirmation of readiness: wait for its ready event or
query state. Then run **CadCove: Open Live Simulation**. The canvas shares the
generic CAD renderer and retains CAD colors; live body poses come from native
physics. Orbit/pan/zoom work as in the CAD view.

Closing the extension fences new simulation starts, cancels pending runtime
installation, and drains starts already waiting for editor task creation. Owned
tasks are then stopped with the verified runtime selected for that launch.
Shutdown does not require installing a replacement runtime or trusting a newly
selected executable. Other applications and externally launched sessions are
not part of this task ownership list.

The simulation canvas is view-only, with only physics real-time percentage in
its footer. Set `runtime.controlSource` to `"driverstation"` and
`runtime.driverStation` to `"gui"` in `robot.sim.json`, then restart. Physical
controllers and enable/disable belong to WPILib Sim GUI (or FRC Driver Station
via the socket provider). Canvas focus never takes control away from Driver Station.

Agents can use `sim-capture`, `sim-view` and `sim-viewer-state` for visual feedback.
For automated controller trials, select `runtime.controlSource: "agent"` and
restart; `sim-controls` retains its input lease. `sim-practice` no longer enables
this canvas. Live Driver Station runs reject scripted control/match takeover.

Set source/build directories and the entry in `.cadcove/project.json`; close and
reopen the CAD panel after changing them. The canvas has no AI input or import
wizard. Imports and robot-specific integration are authored through source files.

## Agent guidance updates

Run **CadCove: Update Agent Guidance** after upgrading. It adds missing discovery
blocks (including Claude support for older workspaces), updates untouched generated
guides, and writes review proposals for team-edited guidance. Read the runtime
output for conflict paths, merge deliberately, then start a new agent conversation.
The extension does not choose or configure an AI provider.

For separate practice/detailed builds, use `cadcove sim-mode` (see `cadcove help`).
A gameplay recipe must match the detailed world hash and declare its assumptions.
Validate the new profile, stop the old session, and select the new manifest using
`simulationProject` in `.cadcove/project.json` before starting again.

## Runtime recovery and updates

Use **CadCove: Repair Runtime** from the Command Palette if runtime validation
reports damaged or missing files. It verifies and, when needed, restores the
exact pinned runtime from the installed platform extension; it works offline.
The operation is cancellable and does not edit CAD, robot sources or project
configuration. Errors are recorded in the **CadCove runtime** output channel.

A repair publishes a fresh verified directory. Existing processes retain their
original files; open a new toolbox terminal or restart an agent terminal to use
the repaired CLI. A healthy repeat does not create another copy. Failed/cancelled
repairs never become the selected runtime. Old generations are retained because
terminals outside the extension may still use them. Do not manually clear the
runtime cache while simulations or agent terminals are running.

Update the extension to update its runtime. Each platform release pins its own
file hashes, so neither a workspace nor a remote "latest" document can choose
executables. A prior extension version can still verify and reuse its own cached
runtime when rolled back. Runtime updates do not overwrite team-customized Java
bridge sources: run `cadcove bridge-export --workspace . --review` for a separate
versioned source copy and per-file comparison. Merge needed changes into the
active `.cadcove/bridge`, preserve custom adapters, then rebuild the team's robot
JAR and run integration checks. The review directory is not compiled by Gradle.

This is not a production release yet. Other platforms, vendor
coverage, redistribution licensing, and publication remain release gates. The
development publisher name is not a Marketplace publishing claim.

## Isolated installation checks

Release engineering can run `scripts/test-toolbox-extension.js CANDIDATE.vsix`
with `CADCOVE_TEST_EDITOR_VERSION=1.105.1` to download and test an exact stock
editor version. Alternatively, set `VSCODE_EXECUTABLE` to a local stable editor's
CLI or native executable. The runner uses a fresh user-data directory, extension
directory and workspace, and closes only that owned editor process tree.

`CADCOVE_TEST_SOFTWARE_GPU=1` explicitly requests SwiftShader for CI machines
without a supported GPU. These flags apply only to the test editor. This is not
evidence of hardware performance. The test installs the actual VSIX, checks
initialization/CAD rebuilds/colors/previews/cache/repair/example export, and
records the editor version and VSIX SHA-256 in its report. A missing adapter or
failed build fails the test; it is not silently skipped. WPILib and actual robot
execution can be added with the separate fixture variables documented in
`docs/TOOLBOX-RELEASE.md`.

## Play the team robot

In the Team Robot edition, run **CadCove: Play Team Robot Example**. Choose a new
workspace; the extension creates the real Team 3310 Amarillo/REBUILT example and
opens live practice. Install the WPILib 2026 JDK first. Matching robot JAR and
vendor libraries are included for the packaged platform. Map plugged-in controllers
in WPILib Sim GUI, then enable Teleoperated there. The command reuses an existing
team-example workspace. The generic source build can include a reviewed local
content pack via `package-runtime.js --team-example EXPORTED_WORKSPACE`; the pack
is not part of the generic MIT source export or a cleared public asset release.

### STEP previews

Right-click `.step`, `.stp`, or `.py` files and select **CadCove: Open in CAD Canvas**. STEP files are imported directly without adding generated source to your CAD source folder. Preview caches update when the selected STEP changes.
