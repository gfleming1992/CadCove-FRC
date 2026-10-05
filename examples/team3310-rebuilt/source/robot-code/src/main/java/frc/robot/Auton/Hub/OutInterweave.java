package frc.robot.Auton.Hub;

import edu.wpi.first.math.geometry.Pose2d;
import edu.wpi.first.math.geometry.Rotation2d;
import frc.lib.util.FieldConstants;
import frc.robot.Auton.AutonCommandBase;
import frc.robot.Auton.Paths;
import frc.robot.RobotContainer;

public class OutInterweave extends AutonCommandBase {
  private static final Pose2d BLUE_START =
      new Pose2d(
          FieldConstants.StartingPosition.BLUEHUB.getTranslation(), Rotation2d.fromDegrees(0));

  public OutInterweave(RobotContainer robotContainer) {

    super(robotContainer, BLUE_START);

    this.addCommands(
        followPath(Paths.hubBackUp),
        robotContainer.buildAutoShootCommand().withTimeout(0.2),
        followPath(Paths.OutInterweave),
        robotContainer.buildAutoShootCommand().withTimeout(5.0));
  }
}
