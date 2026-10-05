---
name: frc-vision
description: Configure and validate Limelight-compatible AprilTag feedback and robot pose estimation for an FRC season and robot.
---

# Limelight and pose estimation

Use `../references/frc-components.md` and the selected season's field/tag
provenance. Inventory each camera's exact model, NetworkTables name, measured
robot-to-camera transform, orientation, pipeline and firmware/helper version.
Do not invent missing cameras. A source comment conflicting with its constants
is an unresolved measurement, not permission to choose whichever works.

Use the team's official LimelightHelpers and actual estimator call path. Confirm
the packet variant expected by the code. MegaTag2 requires orientation input;
do not imply our synthetic pose observations execute the proprietary solver.
Our present model approximates visibility, latency and noise; optical firmware,
image processing and full vendor behavior are not implemented.

Validate field origin, blue-alliance coordinates, tag IDs/layout revision, metres,
degrees/radians and transform direction. Alliance mirroring must happen at the
appropriate planning/control boundary, not twice in the estimator. Match camera
timestamps to the same simulation clock and apply latency once.

Exercise no tags, one/multiple tags, occlusion, long range, robot rotation and
stale observations. Check real helper outputs, pose age, tag count and rejection
reasons. Gate implausible observations and tune estimator uncertainty using data;
do not continuously reset odometry to synthetic ground truth.

Keep camera FOV, noise and latency assumptions in the calibration ledger. Compare
against real logs before claiming vision accuracy. On season changes replace
field geometry and tag layout together, verify their frame alignment, and rerun
visibility and estimator tests independently of robot CAD edits.
