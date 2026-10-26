package org.instantcad.frc;

import com.fasterxml.jackson.databind.*;
import edu.wpi.first.hal.HAL;
import edu.wpi.first.hal.AllianceStationID;
import edu.wpi.first.wpilibj.DriverStation;
import edu.wpi.first.wpilibj.simulation.DriverStationSim;
import java.nio.file.*;
import java.net.*;
import java.net.http.*;
import java.time.Duration;
import java.util.*;

/** Exercises the actual bridge scheduler, HTTP controls, physics, and fail-closed path. */
public final class MotorBridgeTest {
  static final ObjectMapper JSON=new ObjectMapper();
  static final HttpClient HTTP=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
  static JsonNode session;
  static final class Controller implements MotorAdapter {
    volatile boolean configured,invalid;volatile Feedback measured=new Feedback(0,0);
    public String endpoint(){return "test:custom-controller:bus:1";}
    public Map<String,Object> description(){return Map.of("adapter","external-test");}
    public void configure(JsonNode motor){configured=true;}
    public Command sample(double supply){return new Command(invalid?Double.NaN:6,1,true);}
    public void feedback(Feedback value){measured=value;}
  }
  static JsonNode request(String route,String body)throws Exception {
    var builder=HttpRequest.newBuilder(URI.create(session.path("endpoint").asText()+route)).timeout(Duration.ofSeconds(2))
      .header("Authorization","Bearer "+session.path("token").asText()).header("X-CadCove-Run",session.path("runId").asText());
    if(body!=null)builder.POST(HttpRequest.BodyPublishers.ofString(body)).header("Content-Type","application/json");
    var response=HTTP.send(builder.build(),HttpResponse.BodyHandlers.ofString());MotorAdapterTest.check(response.statusCode()==200,"bridge response: "+response.body());return JSON.readTree(response.body());
  }
  interface Condition {boolean accepts(JsonNode state);}
  static JsonNode until(Condition condition)throws Exception {
    long deadline=System.nanoTime()+3_000_000_000L;JsonNode state=null;
    while(System.nanoTime()<deadline){state=request("/state",null);if(condition.accepts(state))return state;Thread.sleep(10);}
    throw new AssertionError("Bridge did not reach condition: "+state);
  }
  public static void main(String[] args)throws Exception {
    MotorAdapterTest.check(HAL.initialize(500,0),"HAL");
    Files.writeString(Path.of(System.getenv("INSTANTCAD_WORLD")),MotorAdapterTest.world().toString());
    var controller=new Controller();TwinBridge.registerMotor(controller,"lift-motor");
    try{
      boolean ds="driverstation".equals(System.getenv("INSTANTCAD_CONTROL_SOURCE"));
      if(ds){DriverStationSim.setAllianceStationId(AllianceStationID.Blue3);DriverStationSim.notifyNewData();}
      TwinBridge.start();session=JSON.readTree(Files.readString(Path.of(System.getenv("CADCOVE_SESSION_FILE"))));
      until(s->s.path("state").path("tick").asLong()>3);MotorAdapterTest.check(controller.configured,"bridge configures external adapter");
      MotorAdapterTest.near(controller.measured.rotorTurns(),0,1e-6,"disabled bridge suppresses requested 6V");
      try{TwinBridge.registerMotor(new Controller(),"another");throw new AssertionError("late registration allowed");}catch(IllegalStateException expected){}
      if(ds){
        MotorAdapterTest.check(DriverStation.getAlliance().orElseThrow()==DriverStation.Alliance.Blue&&DriverStation.getLocation().orElseThrow()==3,"external DS station preserved");
        MotorAdapterTest.check(request("/state",null).path("allianceStation").asText().equals("external"),"external station is not claimed by bridge");
        MotorAdapterTest.check(request("/state",null).path("controlSource").asText().equals("driverstation"),"reports input owner");
        DriverStationSim.setDsAttached(true);DriverStationSim.setJoystickAxisCount(1,6);
        DriverStationSim.setJoystickAxis(1,1,-.7);DriverStationSim.setEnabled(true);DriverStationSim.notifyNewData();
        var attempt=HTTP.send(HttpRequest.newBuilder(URI.create(session.path("endpoint").asText()+"/controls"))
          .header("Authorization","Bearer "+session.path("token").asText()).header("X-CadCove-Run",session.path("runId").asText())
          .POST(HttpRequest.BodyPublishers.ofString("{\"mode\":\"disabled\"}")).build(),HttpResponse.BodyHandlers.ofString());
        MotorAdapterTest.check(attempt.statusCode()==400,"DS rejects virtual controls");
      }else {
        MotorAdapterTest.check(DriverStation.getAlliance().orElseThrow()==DriverStation.Alliance.Red&&DriverStation.getLocation().orElseThrow()==2,"agent station applied to WPILib");
        MotorAdapterTest.check(request("/state",null).path("allianceStation").asText().equals("Red2"),"agent station reported");
        request("/controls","{\"mode\":\"teleop\"}");
      }
      until(s->s.path("state").path("motors").path("lift-motor").path("rotor_turns").asDouble()>.02);
      MotorAdapterTest.check(controller.measured.rotorTurns()>.01,"native feedback delivered to adapter");
      if(ds){
        Thread.sleep(1100); // No CadCove input lease should disable an external DS.
        MotorAdapterTest.check(request("/state",null).path("controlMode").asText().equals("teleop"),"DS owns enable across virtual lease timeout");
        MotorAdapterTest.near(DriverStation.getStickAxis(1,1),-.7,1e-6,"DS joystick input survives physics updates");
        DriverStationSim.setEnabled(false);DriverStationSim.notifyNewData();
      }else request("/controls","{\"mode\":\"disabled\"}");
      until(s->s.path("controlMode").asText().equals("disabled")&&s.path("state").path("motors").path("lift-motor").path("voltage").asDouble(-1)==0);
      controller.invalid=true;var failed=until(s->!s.path("error").asText().isEmpty());
      MotorAdapterTest.check(DriverStation.isDisabled(),"invalid adapter output disables robot");
      long tick=failed.path("state").path("tick").asLong();Thread.sleep(50);MotorAdapterTest.check(request("/state",null).path("state").path("tick").asLong()==tick,"failure halts physics");
      System.out.println("MotorBridgeTest passed: external adapter configuration, native feedback, enabled/disabled voltage gating, late registration and fail-closed invalid output");
    }finally{TwinBridge.stop();}
  }
}
