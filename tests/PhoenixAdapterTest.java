package org.instantcad.frc;

import com.ctre.phoenix6.hardware.*;
import com.ctre.phoenix6.controls.VoltageOut;
import com.ctre.phoenix6.configs.TalonFXConfiguration;
import com.ctre.phoenix6.signals.NeutralModeValue;
import com.ctre.phoenix6.unmanaged.Unmanaged;
import com.fasterxml.jackson.databind.ObjectMapper;
import edu.wpi.first.hal.HAL;

public final class PhoenixAdapterTest {
  static void check(boolean condition,String message){if(!condition)throw new AssertionError(message);}
  static void rejects(Runnable action){try{action.run();throw new AssertionError("Accepted invalid registration");}catch(IllegalArgumentException|IllegalStateException expected){}}
  public static void main(String[] args)throws Exception {
    check(HAL.initialize(500,0),"HAL initialized");
    try(var motor=new TalonFX(61,"cadcove-contract");var encoder=new CANcoder(60,"cadcove-contract");var gyro=new Pigeon2(59,"cadcove-contract")){
      var config=new TalonFXConfiguration();config.MotorOutput.NeutralMode=NeutralModeValue.Coast;
      check(motor.getConfigurator().apply(config,.5).isOK(),"configure actual simulated Phoenix device");
      var adapter=new PhoenixMotorAdapter(motor,false);var model=new ObjectMapper().createObjectNode().put("model","KrakenX60");adapter.configure(model);
      rejects(()->adapter.configure(model.deepCopy().put("model","UnsupportedMotor")));
      adapter.configure(model);adapter.feedback(new MotorAdapter.Feedback(2,.75));
      Thread.sleep(40);
      check(Math.abs(motor.getRotorPosition().refresh().getValueAsDouble()-2)<.01,"raw rotor position reaches actual CTRE SDK");
      check(Math.abs(motor.getRotorVelocity().refresh().getValueAsDouble()-.75)<.01,"raw rotor rate reaches actual CTRE SDK");
      check(motor.setControl(new VoltageOut(3)).isOK(),"robot request accepted");
      double volts=0;long deadline=System.nanoTime()+1_000_000_000L;
      while(System.nanoTime()<deadline){Unmanaged.feedEnable(100);var sampled=adapter.sample(12);check(sampled.coastWhenDisabled(),"configured coast retained");volts=sampled.volts();if(Math.abs(volts-3)<.1)break;Thread.sleep(10);}
      check(Math.abs(volts-3)<.1,"bridge reads real firmware voltage request: "+volts);
      check(adapter.appliedControl().get("name").equals("VoltageOut"),"control diagnostics");
      TwinBridge.registerMotor(adapter,"drive/left");rejects(()->TwinBridge.registerMotor(adapter,"drive/right"));
      rejects(()->TwinBridge.registerMotor(new PhoenixMotorAdapter(motor,true),"drive/other"));
      TwinBridge.registerEncoder(encoder,"steering",.125,false);rejects(()->TwinBridge.registerEncoder(encoder,"other",0,false));
      rejects(()->TwinBridge.registerEncoder(encoder,"other",Double.NaN,0,false));
      TwinBridge.registerGyro(gyro,"chassis");rejects(()->TwinBridge.registerGyro(gyro,"other"));
      System.out.println("PhoenixAdapterTest passed: real SDK voltage/rotor/coast/control and duplicate registration rejection");
    }finally{Unmanaged.feedEnable(0);}
  }
}
