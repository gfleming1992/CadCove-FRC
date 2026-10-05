package frc.robot.util.choosers;

import frc.robot.Auton.AutonCommandBase;
import frc.robot.Auton.Dep.DepCitrus;
import frc.robot.Auton.Dep.DepCollect;
import frc.robot.Auton.Dep.DepMadtown;
import frc.robot.Auton.Forward2mPath;
import frc.robot.Auton.Hub.DepInterweave;
import frc.robot.Auton.Hub.OutInterweave;
import frc.robot.Auton.OneAuton;
import frc.robot.Auton.Outpost.OutCitrus;
import frc.robot.Auton.Outpost.OutCollect;
import frc.robot.Auton.Outpost.OutMadtown;
import frc.robot.RobotContainer;

public class AutonomousChooser extends ChooserBase<AutonomousChooser.AutonomousMode> {
  public AutonomousChooser() {
    super("Autonomous Mode");

    setDefaultOption(AutonomousMode.ONE)
        .addOption(AutonomousMode.FORWARD2MPATH)
        .addOption(AutonomousMode.HUB_OUT_INTERWEAVE)
        .addOption(AutonomousMode.HUB_DEP_INTERWEAVE)
        .addOption(AutonomousMode.DEP_MADTOWN)
        .addOption(AutonomousMode.OUT_MADTOWN)
        .addOption(AutonomousMode.OUT_COLLECT)
        .addOption(AutonomousMode.DEP_COLLECT)
        .addOption(AutonomousMode.OUT_CITRUS)
        .addOption(AutonomousMode.DEP_CITRUS);
  }

  public AutonCommandBase getCommand() {
    return getSelectedMode().getCommand();
  }

  public AutonomousMode getSelectedMode() {
    AutonomousMode selected = getSendable().getSelected();
    return selected != null ? selected : AutonomousMode.DEP_COLLECT;
  }

  public enum AutonomousMode {
    ONE("One"),
    FORWARD2MPATH("Path Forward 2M"),

    DEP_MADTOWN("DepMadtown"),
    OUT_MADTOWN("OutMadtown"),

    HUB_OUT_INTERWEAVE("Hub OutInterweave"),
    HUB_DEP_INTERWEAVE("Hub DepInterweave"),

    DEP_COLLECT("DepCollect"),
    DEP_CITRUS("DepCitrus"),

    OUT_COLLECT("OutCollect"),
    OUT_CITRUS("OutCitrus");

    private String name = "";

    private AutonomousMode(String name) {
      this.name = name;
    }

    @Override
    public String toString() {
      return name;
    }

    public AutonCommandBase getCommand() {
      switch (this) {
        case FORWARD2MPATH:
          return new Forward2mPath(RobotContainer.getInstance());
        case HUB_OUT_INTERWEAVE:
          return new OutInterweave(RobotContainer.getInstance());
        case HUB_DEP_INTERWEAVE:
          return new DepInterweave(RobotContainer.getInstance());
        case DEP_MADTOWN:
          return new DepMadtown(RobotContainer.getInstance());
        case OUT_MADTOWN:
          return new OutMadtown(RobotContainer.getInstance());
        case DEP_COLLECT:
          return new DepCollect(RobotContainer.getInstance());
        case OUT_COLLECT:
          return new OutCollect(RobotContainer.getInstance());
        case OUT_CITRUS:
          return new OutCitrus(RobotContainer.getInstance());
        case DEP_CITRUS:
          return new DepCitrus(RobotContainer.getInstance());
        case ONE:
        default:
          return new OneAuton(RobotContainer.getInstance());
      }
    }

    public boolean requiresPathLoading() {
      return true;
    }

    public boolean disablesVisionSeeding() {
      return false;
    }
  }
}
