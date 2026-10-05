package frc.robot;

import com.ctre.phoenix6.hardware.*;
import com.ctre.phoenix6.CANBus;
import com.ctre.phoenix6.configs.TalonFXConfiguration;
import com.ctre.phoenix6.signals.NeutralModeValue;
import edu.wpi.first.wpilibj.*;
import edu.wpi.first.networktables.NetworkTableInstance;
import edu.wpi.first.math.system.plant.DCMotor;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.instantcad.frc.TwinBridge;
import java.util.Map;
import java.util.LinkedHashMap;
import java.nio.file.*;

/** Independent teaching program. Never deploy example CAN IDs to a real robot. */
public final class Robot extends TimedRobot {
  private final XboxController driver=new XboxController(0);
  private final CANBus bus=new CANBus("cadcove-training");
  private final TalonFX[] drive=new TalonFX[4];
  private final TalonFX lift=new TalonFX(5,bus);
  private final CANcoder liftEncoder=new CANcoder(6,bus);
  private final Pigeon2 gyro=new Pigeon2(7,bus);
  private double liftTarget;
  private static final double LIFT_TURNS_PER_METRE=160/(2*Math.PI);
  public Robot(){
    if(!RobotBase.isSimulation())throw new IllegalStateException("Teaching example is desktop simulation only");
    String[] ids={"front-left","rear-left","front-right","rear-right"};
    var config=new TalonFXConfiguration();config.MotorOutput.NeutralMode=NeutralModeValue.Brake;
    config.CurrentLimits.StatorCurrentLimit=40;config.CurrentLimits.StatorCurrentLimitEnable=true;
    for(int i=0;i<drive.length;i++){
      drive[i]=new TalonFX(i+1,bus);
      if(!drive[i].getConfigurator().apply(config).isOK())throw new IllegalStateException("Drive configuration failed");
      TwinBridge.registerMotor(drive[i],ids[i]+"-motor",false);
    }
    if(!lift.getConfigurator().apply(config).isOK())throw new IllegalStateException("Lift configuration failed");
    TwinBridge.registerMotor(lift,"lift-motor",false);
    TwinBridge.registerEncoder(liftEncoder,"lift-axis",LIFT_TURNS_PER_METRE,0,false);
    TwinBridge.registerGyro(gyro,"chassis");
  }
  @Override public void simulationInit(){
    // The teaching example has no external dashboard. Keep NT local so it
    // cannot take over an existing team's default NetworkTables server port.
    var nt=NetworkTableInstance.getDefault();nt.stopServer();nt.startLocal();
    verifyMotorModel();TwinBridge.start();
  }
  private void verifyMotorModel(){
    try{
      var motor=DCMotor.getKrakenX60(1);
      var world=new ObjectMapper().readTree(Files.readString(Path.of(System.getenv("INSTANTCAD_WORLD"))));
      for(var physical:world.path("motors")){
        if(!physical.path("model").asText().equals("KrakenX60")
          ||Math.abs(physical.path("resistance").asDouble()-motor.rOhms)>1e-10
          ||Math.abs(physical.path("torque_constant").asDouble()-motor.KtNMPerAmp)>1e-10
          ||Math.abs(physical.path("velocity_constant").asDouble()-motor.KvRadPerSecPerVolt)>1e-10)
          throw new IllegalStateException("Training world does not match WPILib Kraken X60 non-FOC motor model");
      }
    }catch(Exception e){throw new IllegalStateException("Cannot verify training motor model",e);}
  }
  @Override public void teleopPeriodic(){
    double forward=-driver.getLeftY(),turn=driver.getRightX();
    double left=forward-turn,right=forward+turn,scale=Math.max(1,Math.max(Math.abs(left),Math.abs(right)));
    for(int i=0;i<4;i++)drive[i].setVoltage(6*(i<2?left:right)/scale);
    // Y raises; A lowers. A real robot needs measured limits and tuned control.
    if(driver.getYButton())liftTarget=.45;
    if(driver.getAButton())liftTarget=0;
    double height=lift.getRotorPosition().getValueAsDouble()/LIFT_TURNS_PER_METRE;
    double speed=lift.getRotorVelocity().getValueAsDouble()/LIFT_TURNS_PER_METRE;
    lift.setVoltage(Math.max(-3,Math.min(3,.20+8*(liftTarget-height)-1.5*speed)));
  }
  @Override public void disabledInit(){for(var motor:drive)motor.stopMotor();lift.stopMotor();}
  @Override public void robotPeriodic(){
    var values=new LinkedHashMap<String,Object>(Map.of("liftTargetMetres",liftTarget,
      "liftRotorTurns",lift.getRotorPosition().getValueAsDouble(),
      "liftEncoderTurns",liftEncoder.getPosition().getValueAsDouble(),
      "gyroYawDegrees",gyro.getYaw().getValueAsDouble()));
    // Use the unchanged vendor helper that students use on the physical camera.
    // Robot code reads normal NT topics; it cannot read native ground-truth poses.
    var estimate=LimelightHelpers.getBotPoseEstimate_wpiBlue("limelight-front");
    values.put("visionTagCount",estimate==null?0:estimate.tagCount);
    if(estimate!=null&&estimate.tagCount>0){
      values.put("visionPoseX",estimate.pose.getX());values.put("visionPoseY",estimate.pose.getY());
      values.put("visionLatencyMs",estimate.latency);
      values.put("visionTimestampSeconds",estimate.timestampSeconds);
      values.put("visionAgeSeconds",Timer.getFPGATimestamp()-estimate.timestampSeconds);
    }
    TwinBridge.publishTelemetry(values);
  }
  @Override public void close(){TwinBridge.stop();for(var motor:drive)motor.close();lift.close();liftEncoder.close();gyro.close();super.close();}
}
