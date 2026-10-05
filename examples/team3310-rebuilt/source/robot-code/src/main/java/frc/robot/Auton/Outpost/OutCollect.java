package frc.robot.Auton.Outpost;

import edu.wpi.first.math.geometry.Pose2d;
import edu.wpi.first.math.geometry.Rotation2d;
import frc.lib.util.FieldConstants;
import frc.robot.Auton.AutonCommandBase;
import frc.robot.Auton.Paths;
import frc.robot.RobotContainer;

public class OutCollect extends AutonCommandBase {
  private static final Pose2d BLUE_START =
      new Pose2d(
          FieldConstants.StartingPosition.BLUEOUTMID.getTranslation(),
          Rotation2d.fromDegrees(90.0));

  public OutCollect(RobotContainer robotContainer) {

    super(robotContainer, BLUE_START);

    this.addCommands(
        followPath(Paths.outCollect),
        robotContainer.buildAutoShootCommand().withTimeout(3.0),
        followPath(Paths.outCollect2),
        robotContainer.buildAutoShootCommand());
  }
}
