package frc.robot.Auton.Outpost;

import frc.robot.Auton.AutonCommandBase;
import frc.robot.Auton.Paths;
import frc.robot.RobotContainer;

public class OutMadtown extends AutonCommandBase {
  public OutMadtown(RobotContainer robotContainer) {
    super(robotContainer, null);

    this.addCommands(followPath(Paths.OutMadtown));
  }
}
