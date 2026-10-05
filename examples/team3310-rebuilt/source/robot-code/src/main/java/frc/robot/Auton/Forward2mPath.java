package frc.robot.Auton;

import edu.wpi.first.math.geometry.Pose2d;
import edu.wpi.first.math.geometry.Rotation2d;
import frc.robot.RobotContainer;

public class Forward2mPath extends AutonCommandBase {
  public Forward2mPath(RobotContainer robotContainer) {
    super(robotContainer, new Pose2d(0, 0, Rotation2d.fromDegrees(0.0)));

    this.addCommands(followPath(Paths.forward2m));
  }
}
