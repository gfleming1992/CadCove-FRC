package org.instantcad.frc;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.TimeUnit;

/** A team-owned controller implementation exercises the native motor boundary. */
public final class MotorAdapterTest {
  static final ObjectMapper JSON=new ObjectMapper();
  static void check(boolean condition,String message){if(!condition)throw new AssertionError(message);}
  static void near(double actual,double expected,double tolerance,String message){check(Math.abs(actual-expected)<=tolerance,message+": "+actual+" expected "+expected);}
  static void rejects(Runnable action){try{action.run();throw new AssertionError("Accepted invalid feedback/configuration");}catch(IllegalArgumentException expected){}}
  static final class TeamController implements MotorAdapter {
    double voltage;Feedback measured=new Feedback(0,0);boolean configured;
    public String endpoint(){return "example:controller:canbus-a:4";}
    public Map<String,Object> description(){return Map.of("adapter","test-team-controller");}
    public void configure(JsonNode physicalMotor){check(physicalMotor.path("id").asText().equals("lift-motor"),"physical identity");configured=true;}
    public Command sample(double supply){check(configured,"configuration before output");return new Command(Math.min(supply,voltage),0,true);}
    public void feedback(Feedback value){measured=value;}
  }
  static void conversions()throws Exception {
    var joint=JSON.readTree("{\"position\":6.283185307179586,\"velocity\":3.141592653589793}");
    var normal=new DeviceMath.EncoderScale(1/(2*Math.PI),.25,false).convert(joint);
    near(normal.rotorTurns(),.75,1e-12,"legacy angular offset");near(normal.rotorRps(),.5,1e-12,"angular rate");
    var inverse=new DeviceMath.EncoderScale(1/(2*Math.PI),.25,true).convert(joint);near(inverse.rotorTurns(),-.75,1e-12,"inverted offset");
    var linear=new DeviceMath.EncoderScale(5,.1,false).convert(JSON.readTree("{\"position\":0.3,\"velocity\":0.2}"));near(linear.rotorTurns(),1.4,1e-12,"linear turns/metre");near(linear.rotorRps(),1,1e-12,"linear speed");
    rejects(()->new DeviceMath.EncoderScale(0,0,false));rejects(()->new DeviceMath.EncoderScale(1,Double.NaN,false));
    rejects(()->new MotorAdapter.Command(Double.NaN,0,false));rejects(()->new MotorAdapter.Command(1,-1,false));rejects(()->new MotorAdapter.Feedback(0,Double.POSITIVE_INFINITY));
    rejects(()->DeviceMath.number(JSON.createObjectNode(),"missing"));rejects(()->DeviceMath.number(JSON.createObjectNode().put("number","1"),"number"));
    rejects(()->new DeviceMath.EncoderScale(1,0,false).convert(JSON.createObjectNode().put("position",2)));
    var body=JSON.readTree("{\"quaternion\":[0,0,0.7071067811865476,0.7071067811865476],\"angular_velocity\":[0,0,1]}");near(DeviceMath.yawDegrees(body),90,1e-10,"Z-up yaw");
    rejects(()->DeviceMath.yawDegrees(JSON.createObjectNode().set("quaternion",JSON.createArrayNode().add(0).add(0).add(0).add(0))));
    rejects(()->DeviceMath.vector(JSON.createObjectNode(),"angular_velocity",3));
  }
  static JsonNode exchange(BufferedWriter writer,BufferedReader reader,JsonNode request)throws Exception {
    writer.write(request.toString());writer.newLine();writer.flush();String line=reader.readLine();check(line!=null,"native reply");var reply=JSON.readTree(line);check(reply.path("ok").asBoolean(),reply.toString());return reply.path("state");
  }
  static JsonNode world()throws Exception {
    return JSON.readTree("""
    {"dt":0.005,"gravity":[0,0,0],"bodies":[{"id":"base","fixed":true,"position":[0,0,0]},
     {"id":"lift","position":[0,0,0],"mass":2,"colliders":[{"kind":"box","half":[0.1,0.1,0.1]}]}],
     "joints":[{"id":"lift-axis","parent":"base","child":"lift","kind":"prismatic","axis":[0,0,1],"anchor_parent":[0,0,0],"anchor_child":[0,0,0]}],
     "motors":[{"id":"lift-motor","joint":"lift-axis","rotor_per_unit":20,"efficiency":1,"resistance":0.1,"torque_constant":0.02,"velocity_constant":50,"current_limit":100}]}
    """);
  }
  static void nativeLoop(String binary)throws Exception {
    var world=world();
    var adapter=new TeamController();adapter.configure(world.path("motors").get(0));adapter.voltage=6;
    var process=new ProcessBuilder(binary).redirectError(ProcessBuilder.Redirect.INHERIT).start();
    try(var writer=process.outputWriter();var reader=process.inputReader()){
      exchange(writer,reader,JSON.createObjectNode().put("op","load").set("world",world));
      for(int i=0;i<1000;i++){
        // A minimal external controller closes a position loop through physical feedback.
        adapter.voltage=Math.max(-6,Math.min(6,12*(1-adapter.measured.rotorTurns())-4*adapter.measured.rotorRps()));
        var command=adapter.sample(12);var request=JSON.createObjectNode().put("op","step").put("steps",1);request.putObject("volts").put("lift-motor",command.volts());
        var state=exchange(writer,reader,request);var feedback=state.path("motors").path("lift-motor");
        adapter.feedback(new MotorAdapter.Feedback(DeviceMath.number(feedback,"rotor_turns"),DeviceMath.number(feedback,"rotor_rps")));
        near(adapter.measured.rotorTurns(),state.path("joints").path("lift-axis").path("position").asDouble()*20/(2*Math.PI),1e-5,"native rotor/joint ratio");
      }
      near(adapter.measured.rotorTurns(),1,.03,"custom controller reaches target via native feedback");
    }finally{process.destroy();if(!process.waitFor(2,TimeUnit.SECONDS))process.destroyForcibly();}
  }
  public static void main(String[] args)throws Exception {conversions();nativeLoop(args[0]);System.out.println("MotorAdapterTest passed: strict units, invalid feedback, custom controller and native closed-loop mechanism");}
}
