# Component selection and evidence

Prefer the team's installed parts, current BOM and matching official documents.
These are engineering choices, not a claim about market share or universal rules.
Read the workspace-relative `componentCatalog` in `.cadcove/frc.json` when set.
In the development checkout, the example's inventory is also available at
`examples/team3310-rebuilt/components.json`. If no catalog is selected, inventory
the active robot; do not assume the example's parts are installed.

| Family | Check before selection/integration | Official reference |
| --- | --- | --- |
| CTRE Phoenix 6 / TalonFX / Kraken | X60 versus X44, FOC model, SDK version, feedback units, current limits, bus IDs, Pro feature requirements, actual bridge support | https://v6.docs.ctr-electronics.com/en/stable/docs/api-reference/simulation/simulation-intro.html |
| WCP Swerve X2 | exact variant/mount, physical drive/steer/coupling ratios, wheel option, offsets and clearance | https://docs.wcproducts.com/welcome/gearboxes/wcp-swerve-x2/overview-and-features/basic-features |
| Drive wheels | molded versus treaded hub versus Colson are different variants; verify rolling radius, width, attachment and measured traction | https://docs.wcproducts.com/welcome/frc-build-system/wheels-and-hubs/traction-wheels |
| Mechanism wheels, rollers, pulleys, bearings | bore/shaft fit, durometer, finished OD, pitch/tooth counts, nip and compression, retained shaft/bearing support | https://docs.wcproducts.com/welcome |
| CANcoder / Pigeon2 | absolute zero, signs, mounting, timestamp and reset behavior | https://v6.docs.ctr-electronics.com/en/stable/ |
| Limelight | hardware model and measured mount, official helper/firmware version, names, latency and estimator behavior | https://docs.limelightvision.io/docs/docs-limelight/pipeline-apriltag/apriltag-robot-localization-megatag2 |
| WPILib | team release, units/frames, command ownership, kinematics and desktop dependency support | https://docs.wpilib.org/en/stable/docs/software/kinematics-and-odometry/swerve-drive-kinematics.html |

Also inventory batteries, power distribution/breakers, radio/network, wire sizes,
connectors, pneumatic components where used, structural stock, fasteners and
service access. Choose to the team's BOM and current season electrical/mechanical
rules. Do not assume simulation supports a sensor/controller simply because its
vendor sells it. REV, AndyMark, Thrifty and other suppliers may be appropriate
when specified; this workflow currently prioritizes the team's CTRE/WCP stack.

Never infer friction or finished rolling radius from color. Keep manufacturer
dimensions separate from CAD measurements and experimentally fitted dynamics.
Pin part files/SDK versions and note source/retrieval date when adopting a change.
