// Copyright (c) 2026 FRC Team 3310
// Use of this source code is governed by an MIT-style
// license that can be found in the LICENSE file.

package frc.robot.Auton;

import com.pathplanner.lib.auto.AutoBuilder;
import com.pathplanner.lib.path.PathPlannerPath;
import edu.wpi.first.wpilibj2.command.Commands;
import edu.wpi.first.wpilibj2.command.SequentialCommandGroup;
import frc.robot.subsystems.drive.Drive;
import org.littletonrobotics.junction.Logger;

/**
 * Follows a PathPlanner path. Delegates entirely to AutoBuilder.followPath() which handles
 * field-relative PID control, subsystem requirements, and odometry correctly.
 */
public class FollowPathCommand extends SequentialCommandGroup {

  /**
   * Creates a new FollowPathCommand.
   *
   * @param drive Unused directly; AutoBuilder owns the Drive requirement via followPath()
   * @param path The PathPlanner path to follow
   */
  public FollowPathCommand(Drive drive, PathPlannerPath path) {
    if (path != null) {
      addCommands(
          AutoBuilder.followPath(path),
          Commands.runOnce(
              () -> {
                Logger.recordOutput("AutoTest/PathName", path.name);
                Logger.recordOutput("AutoTest/FinalPose", drive.getPose());
              }));
    }
  }
}
