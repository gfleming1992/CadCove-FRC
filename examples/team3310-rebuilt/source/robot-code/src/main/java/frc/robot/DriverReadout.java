package frc.robot;

import edu.wpi.first.wpilibj.shuffleboard.Shuffleboard;
import edu.wpi.first.wpilibj.shuffleboard.ShuffleboardTab;
import edu.wpi.first.wpilibj.smartdashboard.SmartDashboard;
import frc.robot.util.choosers.ChooserBase;

public class DriverReadout {

  public DriverReadout(RobotContainer container, boolean shuffleBoard) {
    if (shuffleBoard) {
      ShuffleboardTab tab = Shuffleboard.getTab("Driver Readout");

      tab.add("Autonomous Mode", container.getAutonomousChooser())
          .withSize(2, 1)
          .withPosition(2, 0);
    } else {
      SmartDashboard.putData("Autonomous Mode", container.getAutonomousChooser().getSendable());
    }
  }

  public static void addChoosers(ChooserBase<?>... choosers) {
    for (ChooserBase<?> chooser : choosers) {
      SmartDashboard.putData(chooser.getName(), chooser.getSendable());
    }
  }
}
