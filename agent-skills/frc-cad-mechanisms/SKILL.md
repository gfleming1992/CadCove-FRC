---
name: frc-cad-mechanisms
description: Design or modify FRC CAD using real vendor parts, mechanical interfaces, and explicit simulation bindings.
---

# CAD and mechanisms

Read the active robot's BOM, CAD inventory, constants and calibration ledger.
For component selection read `../references/frc-components.md`. For rule-sensitive
dimensions use the season-rules skill before committing the layout.
For the installed viewer contract and first build read `../references/cad-authoring.md`;
use `../references/native-cadquery.md` for Python execution and exact checks.
Search the installed CadQuery API/docstrings rather than guessing methods. CAD-only work does not require simulation integration.
For physical bodies, units, joints, motors and CAD bindings, read
`../references/physics-authoring.md`. The adjacent mechanism example contains
synthetic test values, not this robot's vendor data or calibration.

Reuse exact vendor STEP components when available. Parameterize team-made plates,
tubes and spacers in plain Python with the full CadQuery/OCP API. Keep each reusable
part separate from its assembly placements. Do not replace curved or detailed
parts with boxes merely to fit the command interface. Simplified collision
geometry is a separate artifact with declared approximation.

Before modeling, establish shaft/bore profiles, bolt patterns, bearing support,
gear/pulley tooth counts, belt pitch, motor clearance, connector access, travel
envelope and service/removal path. Check packaging at both travel limits and
across swept motion, including bumpers, wiring and game-piece path. A purchased
part's advertised name does not establish all these dimensions.

Keep CAD mm/Z-up and physics SI conversions at an explicit boundary. Preserve
occurrence-to-body bind transforms and module frame conventions. Derive connected
transmission ratios and direction from physical stages; compare independently
with controller constants. Count a motor/output reduction once. A belt can link
multiple rollers without adding fictitious motors; followers must act on the
same mechanical system where shafts are coupled.

STEP conveys geometry/placements, not trustworthy joints, material, mass,
actuation, friction or control intent. Record measured/derived/estimated/unknown
values and source references. Ask for the smallest missing measurement that
affects the decision; do not label inferred dynamics as manufacturer data.

Lessons from the team model:

- A filled convex hull can close a real feeder opening. Test clearance with
  source geometry and negative-control collision fixtures before tuning friction.
- Visually rotating wheels without corresponding powered collision bodies do
  not transfer momentum. Trace the complete roller/belt train.
- Bare tubing can omit rubber. Distinguish radial sleeve thickness from diameter;
  use the actual finished OD and material evidence, not whatever improves intake.
- Rubber compression and game-piece compliance affect nip geometry; don't shrink
  balls, teleport them, or delete guide plates to pass pickup tests.

Run `cad-build`, exact assertions with `cad-inspect`, and focused `cad-capture` images.
Recompile world/bindings if geometry or mechanics changed; run `audit`. Captures
should fit the edited mechanism plus necessary surrounding clearance. Retained
old geometry or a beautiful render is not proof the edit built successfully.
