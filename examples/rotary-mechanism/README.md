# Shared CAD / physics rotary mechanism

This original teaching example links a motor shaft through a 20:40 external gear
pair, a 20:40 open timing-belt drive, and a 16:32 chain drive. Each shaft and its
attached wheels form one rigid body. For +360° at the input, the other shafts
turn −180°, −90°, and −45°. Pulleys and sprockets use schematic tooth profiles;
the example is not a manufacturing design. Flexible belt/chain links are not
animated. Motor constants, masses and compliance are explicitly estimated.

Copy `cad/` into an existing workspace's configured CAD source folder, for
example as `mechanism-demo/`. Open `mechanism-demo/models.py` in the CAD canvas.
The commands use that entry's adjacent `mechanism.json`:

```sh
cadcove cad-rotate --workspace . --entry mechanism-demo/models.py --part input-gear --degrees 90
cadcove cad-animate --workspace . --entry mechanism-demo/models.py --part demo-motor --rpm 15 --seconds 20
cadcove cad-motion-state --workspace . --entry mechanism-demo/models.py
cadcove cad-motion-stop --workspace . --entry mechanism-demo/models.py
cadcove cad-motion-reset --workspace . --entry mechanism-demo/models.py
cadcove mechanism-export --workspace . --entry mechanism-demo/models.py --output build/mechanism-physics
```

Rotation coordinates are absolute degrees, not increments. Animation starts at
the displayed pose and stops at its duration. Negative RPM reverses motion.
Reset restores the authored pose. These are CAD inspection commands: they
never command a physical motor or start a robot runtime. CAD exports and build
previews retain the authored pose; explicit captures include the temporary pose.

The export produces `world.json` accepted by the native physics engine,
`scene-bindings.json` mapping occurrences to bodies, and a provenance report.
It is a mechanism artifact, not a complete WPILib/field deployment. The portable
integration test loads this same world and applies voltage to the synthetic
motor, verifying that all three transmissions follow their signed ratios.

## Metadata contract

- `schema: 1`, `units: "mm-deg"`.
- Bodies have stable IDs, world-space `origin`, `fixed`, and occurrence `parts`.
  Body bind frames currently have identity orientation. Parts must belong to one
  body; simulation export requires every visible occurrence to be mapped.
- Revolute joints have `parent`, `child`, world-space `origin` and unit `axis`,
  `bindAngleDeg`, optional `limitsDeg`, and explicit `damping` for physics.
  The first version requires fixed parents and one joint per moving body.
- Gear/belt/chain relations have joint `driver`/`follower`, positive integer
  `driverTeeth`/`followerTeeth`, `direction` (+1 or −1), and `phaseDeg`.
  Follower = direction × driverTeeth/followerTeeth × driver + phaseDeg.
  Bind angles must satisfy the relation. Closed relation loops are rejected.
- Motor IDs point to joints. A shaft's attached gear, pulley and sprocket parts
  share its rigid body; there is no extra ratio between parts on one shaft.
- Physics requires explicit `massKg`, body-local `centerOfMassMm`,
  `principalInertiaKgMm2` aligned with the body axes, `friction`, collision
  primitives and `provenance`. Colliders currently support boxes and cylinders;
  cylinder axes are local Y before the explicit axis-angle `rotationRad`.
  All lengths and inertia units are converted once at export to SI.
- Transmissions require stiffness, damping and maximum effort. Native physics
  uses compliant coupling, while the CAD preview uses exact prescribed ratios.
  Motor electrical parameters are explicit; missing inputs fail export.

No contact-based tooth meshing, backlash, belt tension, chain flexibility, or
vendor calibration is inferred. Their absence is recorded in the export scope.
