package org.instantcad.frc;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;

/** Desktop motor-controller boundary. Implement against the team's actual SDK.
 * Robot code keeps ownership of control requests; this is trusted in-process code.
 */
public interface MotorAdapter {
  record Command(double volts,double supplyCurrent,boolean coastWhenDisabled) {
    public Command {if(!Double.isFinite(volts)||!Double.isFinite(supplyCurrent)||supplyCurrent<0)throw new IllegalArgumentException("Nonfinite/negative motor command or current");}
  }
  record Feedback(double rotorTurns,double rotorRps) {
    public Feedback {if(!Double.isFinite(rotorTurns)||!Double.isFinite(rotorRps))throw new IllegalArgumentException("Invalid rotor feedback");}
  }
  /** Unique hardware endpoint including vendor/device family and bus identity. */
  String endpoint();
  Map<String,Object> description();
  /** Called before physics starts; validate controller/native model compatibility. */
  void configure(JsonNode physicalMotor);
  Command sample(double supplyVoltage);
  void feedback(Feedback feedback);
  /** Host-side control request diagnostics, not a firmware acknowledgement. */
  default Map<String,Object> appliedControl(){return Map.of("available",false);}
}
