# Start with your existing editor agent

## Files and command-line feedback

Agents use the CLI and filesystem. Start with `.cadcove/AGENT.md`, then the
native CadQuery authoring reference. Run `cadcove cad-build`, inspect with
`cad-inspect --script checks.py`, and keep `cad-session` warm for iterations.
Use `open_robot_cad` if exposed by the chat, otherwise run
`cadcove cad-open --workspace .` to open the robot in VS Code.
The extension starts its authenticated local server automatically in a trusted
CadCove workspace. Missing chat tools indicate agent discovery, not a stopped
server; do not require a manual start or tool registration for the CLI route.
Right-clicking a Python/STEP file also opens the model. Use `cad-capture`
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

Missing discovery blocks are appended; exact older generated blocks are upgraded.
Customized blocks and surrounding team instructions are preserved. Edited
or deliberately deleted generated guidance yields review proposals and exit 1.
Merge team knowledge, inspect reported conflicts, and start a new agent session.
Bridge source upgrades are separate: `cadcove bridge-export --workspace . --review`.


### Place game pieces in a running full simulator

Use MCP `simulation_place_game_pieces` or `cadcove sim-place --project robot.sim.json --input placements.json`.
Query `sim-objects` first for existing game-piece IDs. The request contains
`placements: [{id, position: [x,y,z], velocity?: [vx,vy,vz], frame?: bodyId}]`.
Lengths are metres and velocities metres/second. Without `frame`, coordinates
are world-space; with a body frame, its live pose and velocity are applied.
The whole batch is validated before any piece moves. Placement releases prior
practice cargo ownership, resets spin, and keeps collisions and gravity active.
This repositions authored game pieces; it does not create new geometry,
change robot enable state, or certify an overlap-free spawn. Keep the ball's
radius clear of surfaces when dropping it. Jointed bodies are rejected. An
active deformable ball is reset to its undeformed shape at the requested pose;
its old soft body is removed, and it can deform again in an authored zone. Current support uses the explicit practice game-piece pool. A ball
that physically reaches an authored hopper storage slot can enter the practice
feeder without crossing the intake; feed/launch remain reduced-order mechanisms.

For a hopper with physical support geometry, set `gameplay.passive_storage: true`
to disable storage-position spring forces: stored balls settle under gravity and
contact. Author slots at the lower feeding floor, not above the hopper opening.
Inventory admission still requires contact near an authored slot. Deployment
geometry and its state must match the tested setup; a retained deployed hopper
is not evidence that its contact-driven deployment transition is simulated.

Native physics supports `one_way: true` on bounded prismatic joints for ideal
retention: physical contact or a motor can extend the joint, while its lower
stop follows the greatest reached position. Reloading a new world clears that
retention. This adds no deployment force and does not establish an unknown
linkage, latch-release condition, or contact trajectory.

For deformable lower-hopper transport, `gameplay.robot_compliance: true` requires
passive storage and a physical `pickup` region on every launcher. Author foam
properties on game-piece bodies and compliance zones around the moving robot.
Intake teleport/conveyor capture is disabled in this mode; roller contact moves
balls. A ball contacting the actual pickup region can enter feeder inventory
without first resting in a slot. Final launch still uses the declared practice
model; this is not a resolved wheel-to-ball launch calculation. Foam stiffness,
roller friction, pickup regions and real-time performance require calibration.
Field-only compliance and robot compliance are separate, mutually exclusive modes.

For a contact-only subsystem experiment, use `simulation_manipulate_game_piece`
(or `sim-manipulate --input JSON_FILE`) to approach a roller with a finite-force
virtual hand, then release. Query physical body IDs first. Specify target position,
optional rigid body frame, duration, maximum force and speed. The same running
canvas continues displaying the authoritative physics. Release preserves velocity
and deformation; practice capture/feed/launch stays disabled for that piece until
explicitly restored. Read tracking error and actual trajectory before describing
pull-in, jamming or ejection. See `docs/SIMULATION-MODES.md` for the contract.

### Isolated subsystem view

Use MCP `simulation_view` with `bodies` (exact physical body IDs), `fit: true`
and optionally `view: "iso"` to inspect any subsystem on a blank background.
Include the desired game-piece IDs. Use `simulation_objects` to discover bodies;
include the mechanism's wheels, shafts, guides and supports. This command changes
presentation only: hidden bodies still participate in physics. It does not create
an independent test bench or remove contacts, and never starts motors.
Set `bodies: null` to restore the full scene. Pan/zoom/orbit remain available.
The CLI equivalent is `sim-view --options FILE` with the same options.
Use `simulation_manipulate_game_piece` to approach and release a ball physically;
keep automatic feeding/launch disabled for that ball when testing contact behavior.
