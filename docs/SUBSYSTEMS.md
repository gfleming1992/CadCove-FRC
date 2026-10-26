# Authored subsystem selection and physical completeness

A CAD assembly is a packaging tree, not a rigid body or a complete mechanism. A shooter branch can omit a feeder, stationary motor housings, bearings, and belts located elsewhere. Subsystems explicitly join the CAD tree to the mechanical dependency graph. The resolver never guesses membership from labels, ID prefixes, or geometric proximity.

`lib/subsystem-model.js` exports `indexAssemblyTrees(trees)` and `resolveSubsystem(manifest, id, context)`. Both are deterministic, read-only functions. A resolved selection is not applied to a canvas and does not start physics. A caller can present the result, explicitly isolate its `occurrenceIds`, and separately build/validate a physical test fixture. Never pass only a truncated mesh selection to a whole-robot physical model.

## Stable tree input

Each descriptor is `{id, kind, root, revision?}`, where `kind` is `step`, `cadquery`, or `mixed`. `root` is a recursively nested `{id, name?, children?}` node. STEP `assembly.json` is already this shape. CadQuery projects should author/export the same hierarchy with stable rendered occurrence IDs; names are display labels, not identity. A leaf represents one rendered occurrence. Distinct occurrences of the same prototype have distinct IDs. Multiple trees can coexist, including native CadQuery parts alongside an imported STEP assembly. IDs must be globally unique across them.

A tree is geometry organization only. Its group nodes must not be invented as physics bodies. Explicit rigid bodies own leaf occurrences; joints connect bodies, and transmissions connect joint coordinates. Relationships may cross CAD branches. Fixed or external bodies form declared test boundaries, while stationary support geometry can remain visible without importing the entire chassis.

`context` supplies `trees`, `mechanism`, optional rendered `parts` (IDs or objects with `id`), optional `sourceRevision`, and optional `materials` (an ID-keyed object or array of IDs/objects). `mechanism` accepts the current rotary definition, an SI physical model under `physical`, or a standalone SI model identified by `units: "m-kg-s-rad"`. All body part IDs must resolve in a supplied tree, including authored demo parts. Pass an explicit additional authored tree for such parts; do not silently drop them to bypass stale-reference checks.

## Manifest schema 1

```json
{
  "schema": 1,
  "trees": [{"id":"robot-step","kind":"step","file":"cad-assets/robot/assembly.json"}],
  "subsystems": [{
    "id": "shooter",
    "name": "Shooter and feeder",
    "dependencies": ["feeder"],
    "roots": {"assemblies": ["turret-assembly"]},
    "include": {"occurrences": ["guide-plate"]},
    "exclude": {"occurrences": ["cosmetic-cover"]},
    "stationarySupports": {"assemblies": ["motor-housing-assembly"]},
    "mechanical": {"bodies": ["flywheel"], "joints": ["flywheel-axis"], "motors": ["shooter-motor"], "transmissions": ["flywheel-belt"]},
    "boundaries": [{"body":"chassis","mode":"fixed","reason":"Bench mounting fixture"}],
    "requirements": {
      "expectedBodies": ["flywheel", "feeder-shaft"],
      "expectedJoints": ["feeder-axis"],
      "expectedMotors": ["feeder-motor"],
      "expectedTransmissions": ["feeder-belt"],
      "contactBodies": ["flywheel", "feeder-shaft"],
      "materials": ["fuel-2026"]
    },
    "provenance": {"status":"derived","evidence":"Stable occurrence bindings, inspected CAD shafts and authored transmission graph"}
  }]
}
```

This is a schema example, not a runnable robot. Define the referenced feeder subsystem and actual source IDs. `trees` file paths are loader metadata; the pure resolver consumes trees supplied in context. File loaders must resolve paths against the workspace, reject traversal, and check loaded IDs/revisions. Optional `sourceRevision` pins the rendered source revision; `treeRevisions` maps tree descriptor IDs to exact supplied revisions. A mismatch fails rather than accepting a retained preview. Without revision pins, ID consistency is checked but unchanged IDs do not prove unchanged geometry.

All selectors use `assemblies` and/or `occurrences`. Assemblies recursively expand to leaves. `dependencies` form an acyclic subsystem graph; their selections, boundaries and requirements are merged. Exclusions apply after physical dependency expansion and produce incomplete-selection issues when they remove a mechanically required occurrence. Rendering exclusions do not silently delete colliders.

Explicit `mechanical` references must exist. Selecting a moving body’s leaf brings that body and its complete occurrence membership into the selection. Joint parents and coupled transmission endpoints are followed transitively; motors attached to selected joints are included. A declared boundary stops parent expansion. Stationary support selection includes its geometry but does not expand a fixed chassis into the entire robot. Each boundary must state its reason and whether it is fixed by a fixture or external to the test. External boundaries are reported as unresolved for standalone physical completeness; they must be satisfied in a full-world integration.

`expectedBodies`, `expectedJoints`, `expectedMotors` and `expectedTransmissions` are intentionally different from explicit references: they express known required definitions that may not have been authored yet. Missing expected definitions produce clear incomplete reports. This permits the full CAD feeder to be shown while its missing physical shafts remain an honest blocker, rather than assigning their geometry to chassis and claiming success.

## Result and validation

The result contains sorted occurrence IDs, stationary support IDs, excluded IDs, subsystem dependency closure, mechanical body/joint/motor/transmission IDs, boundaries, requirements and `physics` issues. Unknown selector IDs, duplicate occurrence ownership, dangling mechanical edges, incompatible boundary modes, stale rendered IDs/revisions, assembly cycles, legacy rotary joint hierarchy cycles and subsystem dependency cycles throw errors. Explicit SI physical models may contain closed joint loops, including four-bar linkages: dependency closure uses finite sets and follows all required links deterministically. Closed transmission loops are also permitted because they are mechanical constraints, not a hierarchy. The canonical physical model and native solver must validate physical loop constraints and numerical behavior separately; accepting the dependency graph does not prove the linkage can be assembled or stepped stably.

The completeness report checks required mass, center, positive inertia components, provenance, joint damping, motor electrical fields (signed nonzero rotor ratios for explicit SI models; positive ratios for the legacy exporter), transmission compliance, requested contact shapes/friction, materials and expected mechanical references. `physics.complete` means these declared requirements are present. It does **not** certify shape validity, inertia positive definiteness, material calibration, collision clearance, motor sign, stable stepping, successful feeding, or safe hardware operation. `nativeValidationRequired` remains true. The canonical physical compiler and native validator remain authoritative for schema and numerical validity; subsystem contact trials remain mandatory.

Keep source hashes, material provenance, simulation approximations, bench restraints, fixture initial conditions, contact results and calibration status in the test report. Preview playback controls are separate from physical planning and validation. Do not automatically animate or feed a ball when resolving or isolating a subsystem.

## Team example scope

The Team 3310 workspace `config/subsystems.json` provides left feeder, left shooter plus feeder, intake, and drivetrain selections. The left feeder explicitly includes six historical shaft memberships outside the turret branch, along with their belts and stationary drive housing. Historical bindings establish membership evidence only; their stale world is not reused as validated current physics. Missing live feeder definitions are reported. Intake properties remain estimated and its pivot lacks a holding motor. Drive wheel contacts currently disabled are reported incomplete. These examples must be enriched as the physical model evolves, not used to infer that a clean visual selection is a qualified machine.

## CLI and agent entry point

Use `cadcove subsystem --workspace PATH --action list` to discover names.
`--action inspect --id ID` returns membership, source revision, mechanical
closure and missing requirements. `--action validate --id ID` returns a nonzero
exit code when declared requirements are incomplete. `--action show --id ID`
isolates and frames the resolved occurrences in the existing CAD canvas; it
does not start motion or physics. The default manifest is
`config/subsystems.json`; `--manifest` can name another workspace-relative file.

The loader reads current built CAD and the adjacent `mechanism.json`, derives
tree revisions from actual file bytes, and preserves source revision in results.
Unlisted current CadQuery leaves appear in an explicit ungrouped tree; they are
not silently assigned to an imported assembly. Agents should author meaningful
CadQuery assembly nodes and subsystem memberships once, then reuse them for
isolation, physical fixtures and replay presentation.
