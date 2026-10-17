# Changelog

## 0.2.0-rc.1 — native CadQuery preview

- Native Python/CadQuery is the only CAD authoring backend; removed brepjs and
  the browser OCCT/WASM kernel from the extension.
- Converted all 109 authored Team 3310 designs; preserved 320 vendor/unclassified
  STEP prototypes and the 1,958-part assembly.
- Released CLI as JavaScript plus a small native launcher using separately
  installed Bun 1.4.2; no embedded Bun/JSC redistribution.
- Cache reopening checks now tolerate watcher event ordering while verifying
  the exact revision, GPU geometry and no Python startup.
- System card, native agent workflow, platform evidence and Windows checklist.

### Included improvements

- Corrected team example intake joints, collider positions and mesh bindings;
  optional declared shaft-point checks reject off-axis rotating meshes during
  project audit and content packaging.
- Component mesh caching and incremental GPU updates preserve camera position
  during CAD edits in the browser and VS Code.

- Agent-first CAD, actual robot code integration, and native live/detailed simulation.
- Shared workspace guidance discovered by Codex, Claude Code and GitHub Copilot;
  additive upgrades preserve team instructions and provide conflict proposals.
- Six focused FRC workflows, offline CAD API references, local page-cited season
  knowledge, explicit CTRE/Limelight device and season contracts.
- Installed `sim-mode` command creates separate source-pinned physics builds.
- Practice storage retains ball collisions; packages require current cargo and
  field-conveyor native capabilities.
- MIT original code, independent generic CAD core, reviewed source export,
  dependency notices and platform qualification gates.

Early-access candidate; see `docs/TOOLBOX-RELEASE.md` before publishing binaries.
