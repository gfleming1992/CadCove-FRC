# External season provider example

This is a small **training game**, not official FRC scoring. It demonstrates how
team-owned Java code can implement new game rules without modifying CadCove.

After exporting the CadCove bridge into a Java robot project:

1. Copy/merge this example's `src/main/java` and `src/main/resources` into the
   team project. Keep the ServiceLoader provider line when building its JAR.
2. Copy the object in `season.json` into the complete world's `season` field.
   Set `config.bodies` to real physical body IDs and choose a goal plane (metres)
   and duration (seconds). Remove legacy `rebuilt2026` if it is present.
3. Regenerate scene-binding/world hashes, build the robot's desktop simulation,
   and run the normal CadCove CLI. `sim-match` should list
   `example.training-zone`. Start with `{"action":"start","options":{}}`.
4. Renew match control packets while driving. A piece crossing goalX from below
   scores once per forward crossing. Crossing back and then forward scores again.
   Stationary pieces do not repeatedly score. A crossing before the time limit
   is counted even if the next observed frame is after that limit.

Replace this deliberately simple rule with the actual season rules and tests.
The observer only reads native body state; it does not move a piece or issue
motor commands to force a score. `docs/SEASON-PLUGINS.md` in the source repository
(or `SEASON-PLUGINS.md` in the exported bridge) describes the full contract.
