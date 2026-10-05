package frc.robot.util.choosers;

import edu.wpi.first.wpilibj.smartdashboard.SendableChooser;

public class ChooserBase<Type> {
  private SendableChooser<Type> chooser = new SendableChooser<>();
  private String name = "";

  protected ChooserBase(String name) {
    this.name = name;
  }

  public String getName() {
    return name;
  }

  protected ChooserBase<Type> setDefaultOption(Type option) {
    chooser.setDefaultOption(option.toString(), option);
    return this;
  }

  protected ChooserBase<Type> addOption(Type option) {
    chooser.addOption(option.toString(), option);
    return this;
  }

  protected ChooserBase<Type> addOptions(Type[] options) {
    for (Type option : options) {
      chooser.addOption(option.toString(), option);
    }
    return this;
  }

  public SendableChooser<Type> getSendable() {
    return chooser;
  }
}
