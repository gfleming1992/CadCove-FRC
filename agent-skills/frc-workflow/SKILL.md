---
name: frc-workflow
description: Coordinate CAD, robot code, and simulation changes in a CadCove FRC workspace, including choosing the relevant specialist workflow.
---

# FRC workflow

Read `.cadcove/AGENT.md` for the installed CLI contract and `.cadcove/frc.json`
for the selected example and season knowledge directory. Selection of a knowledge
pack does not change the runtime's field, robot, or season observer.

Read only the skills needed for the task, under this directory's siblings:

| Task | Skill |
| --- | --- |
| Rules, requirements, season rollover | `frc-season-rules/SKILL.md` |
| Parts, mechanisms, assembly edits | `frc-cad-mechanisms/SKILL.md` |
| CTRE devices, drivetrain, command code | `frc-ctre-controls/SKILL.md` |
| Limelight, AprilTags, pose estimation | `frc-vision/SKILL.md` |
| Commissioning, practice, regressions, performance | `frc-simulation-validation/SKILL.md` |

For a new robot: establish season requirements → inventory actual parts and code
→ CAD/layout → reviewed mechanism bindings → device integration → isolated
commissioning → autonomous/practice trials → evidence and remaining unknowns.
For an edit, revisit only affected stages and their dependencies.

Keep robot and field independent. The main worked example is the team's Amarillo
robot on REBUILT; its CAN IDs, gains, controls, calibration, and occurrence IDs
are examples, never defaults for a different robot. The small training robot is
a regression fixture. Read the workspace's `example-provenance.json` and the
`componentCatalog` path in `.cadcove/frc.json` when present. In a source checkout,
`examples/team3310-rebuilt/example.json` records the demo's replacement contract.

Use existing parts before designing lookalikes. Preserve reusable STEP/JS parts,
stable occurrence IDs, assembly transforms, original colors and source hashes.
Record part/variant, source, dimensions, mechanism role, and evidence confidence.
Keep student subsystem/command structure; compile against its vendordeps.

Make one reviewable change, build, inspect revision-matched CAD feedback, run
relevant native/actual-code checks, and record results before broadening changes.
A screenshot is appearance evidence; telemetry is behavior evidence. Neither
alone proves dimensional legality, calibrated physics, or hardware readiness.

Report source revisions, changed requirements, tests, and unresolved measurements.
Do not turn an approximation selected for practice into a sign-off claim. Keep
hardware deployment separate from an authorized desktop simulation task.
