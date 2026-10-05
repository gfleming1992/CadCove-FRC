package org.instantcad.frc;

import com.ctre.phoenix6.hardware.TalonFX;
import com.ctre.phoenix6.configs.TalonFXConfiguration;
import com.ctre.phoenix6.signals.NeutralModeValue;
import com.ctre.phoenix6.sim.ChassisReference;
import com.ctre.phoenix6.sim.TalonFXSimState.MotorType;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/** Phoenix 6 TalonFX implementation, using the team's existing device instance. */
public final class PhoenixMotorAdapter implements MotorAdapter {
  private final TalonFX device;
  private final boolean clockwise;
  private boolean coast;
  public PhoenixMotorAdapter(TalonFX device,boolean clockwise){
    this.device=Objects.requireNonNull(device);this.clockwise=clockwise;
  }
  public String endpoint(){return "ctre:talonfx:"+device.getNetwork().getName()+":"+device.getDeviceID();}
  public Map<String,Object> description(){return Map.of("adapter","phoenix6-talonfx","canId",device.getDeviceID(),"network",device.getNetwork().getName(),"clockwise",clockwise);}
  public void configure(JsonNode motor){
    device.getSimState().Orientation=clockwise?ChassisReference.Clockwise_Positive:ChassisReference.CounterClockwise_Positive;
    String model=motor.path("model").asText("KrakenX60");MotorType type;
    try{type=MotorType.valueOf(model);}catch(IllegalArgumentException error){throw new IllegalArgumentException("Phoenix motor model "+model+" is unsupported by this team's SDK; implement/qualify a compatible MotorAdapter instead of substituting another motor",error);}
    var status=device.getSimState().setMotorType(type);if(!status.isOK())throw new IllegalStateException("Cannot configure simulated motor type: "+status);
    var config=new TalonFXConfiguration();status=device.getConfigurator().refresh(config,.2);if(!status.isOK())throw new IllegalStateException("Cannot read configured motor "+endpoint()+": "+status);
    coast=config.MotorOutput.NeutralMode==NeutralModeValue.Coast;
  }
  public Command sample(double supplyVoltage){var sim=device.getSimState();sim.setSupplyVoltage(supplyVoltage);return new Command(sim.getMotorVoltage(),Math.max(0,sim.getSupplyCurrent()),coast);}
  public void feedback(Feedback feedback){var sim=device.getSimState();sim.setRawRotorPosition(feedback.rotorTurns());sim.setRotorVelocity(feedback.rotorRps());}
  public Map<String,Object> appliedControl(){var request=device.getAppliedControl();var result=new LinkedHashMap<String,Object>();result.put("name",request==null?null:request.getName());if(request!=null)result.put("parameters",request.getControlInfo());return result;}
}
