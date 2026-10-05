package frc.lib.subsystems;

import com.ctre.phoenix6.configs.CANcoderConfiguration;
import frc.lib.drivers.CANDeviceId;

public class CanCoderConfig {
  public CANDeviceId CANID;
  public CANcoderConfiguration config = new CANcoderConfiguration();
}
