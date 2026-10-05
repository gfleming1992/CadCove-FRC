package frc.robot.Auton;

import edu.wpi.first.wpilibj2.command.Commands;
import frc.robot.RobotContainer;

public class OneAuton extends AutonCommandBase {
  public OneAuton(RobotContainer robotContainer) {
    super(robotContainer, null);

    this.addCommands(Commands.none());
  }
}
