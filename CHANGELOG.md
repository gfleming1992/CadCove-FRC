# Changelog

## Unreleased — unified 0.2 RC2 candidate

- Merge Windows fixes into `release/native-cadquery-0.2`, shared with macOS.
- Run the source/installed-editor workflow on Windows x64, macOS arm64/x64 and
  Linux x64. Keep published RC1 artifacts unchanged; identify new builds as RC2.
- Apply bounded staging cleanup to the source Team 3310 setup path as well as
  packaged example creation. The Team 3310 example remains included.

- Verify a concurrent install/repair winner before reusing it when Windows
  reports a sharing or rename permission error. Corrupt winners still fail.
- Allow two minutes for Windows cold native-world startup and validation.
- Allow 15 minutes for cold Windows CAD operations, retain the explicit timeout
  error, and verify that a timed-out worker can restart. Retry transient Windows
  locks when publishing a completed example after Gradle exits.
- Honor Cargo's explicit platform linker when compiling the CLI launcher;
  support Windows Gradle batch launchers in the training verifier.
- Keep the Windows launcher and all descendants in a kernel job, preventing
  orphaned Bun/robot processes when the packaged executable is terminated.
- Keep the downloaded Windows test editor in a short temporary cache path to
  avoid installation failures from deeply nested checkout paths.
- Retry temporary Windows locks during private example staging cleanup, so a
  successfully copied example does not report failure while an editor scans it.
- Correct native CAD test file URLs and use Windows junctions for redirected
  path boundary tests without requiring administrator privileges. Allow a
  bounded 60 seconds for filesystem-heavy portable tests.
- Refresh the generic CAD test pin from a separate local Windows-fix repository
  based on the release's exported core, including the bounded Windows deadline.

These changes do not establish Windows 10, GPU, controller or robot-hardware
qualification. Release attachments must report their actual host and scope.

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
