package frc.robot.Auton.Dep;

import edu.wpi.first.math.geometry.Pose2d;
import edu.wpi.first.math.geometry.Rotation2d;
import frc.lib.util.FieldConstants;
import frc.robot.Auton.AutonCommandBase;
import frc.robot.Auton.Paths;
import frc.robot.RobotContainer;

public class DepCollect extends AutonCommandBase {
  private static final Pose2d BLUE_START =
      new Pose2d(
          FieldConstants.StartingPosition.BLUEDEPMID.getTranslation(),
          Rotation2d.fromDegrees(-90.0));

  public DepCollect(RobotContainer robotContainer) {

    super(robotContainer, BLUE_START);

    this.addCommands(
        followPath(Paths.depCollect),
        robotContainer.buildAutoShootCommand().withTimeout(3.0),
        followPath(Paths.depCollect2),
        robotContainer.buildAutoShootCommand());
  }
}
