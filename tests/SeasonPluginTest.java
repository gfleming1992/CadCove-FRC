package org.instantcad.frc;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.util.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

public final class SeasonPluginTest {
 static final ObjectMapper JSON=new ObjectMapper();
 static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 static void rejects(Runnable action,String message){try{action.run();throw new AssertionError("Accepted "+message);}catch(IllegalArgumentException|IllegalStateException expected){}}
 static ObjectNode world()throws Exception{return (ObjectNode)JSON.readTree("""
 {"dt":0.01,"gravity":[0,0,0],"bodies":[{"id":"practice-piece","position":[0,0,0],"velocity":[3,0,0],"mass":1,"colliders":[{"kind":"ball","radius":0.1}]}],"joints":[],"motors":[],
 "season":{"schema":1,"adapter":"example.training-zone","config":{"schema":1,"bodies":["practice-piece"],"goalX":2,"duration":1.5}}}
 """);}
 static ObjectNode state(long tick,double x){var s=JSON.createObjectNode().put("tick",tick);var b=s.putObject("bodies").putObject("practice-piece");b.putArray("position").add(x).add(0).add(0);b.putArray("velocity").add(3).add(0).add(0);b.putArray("quaternion").add(0).add(0).add(0).add(1);b.putArray("angular_velocity").add(0).add(0).add(0);return s;}
 static void discoveryAndRules()throws Exception{
  var world=world();var runtime=new MatchRuntime(world);check(runtime.snapshot().get("adapter").equals("example.training-zone"),"ServiceLoader selects requested provider");
  var first=state(0,0);runtime.start(first,JSON.createObjectNode());check(runtime.mode().equals("teleop"),"training mode");
  var next=state(100,3);String before=next.toString();runtime.advance(next);check(runtime.snapshot().get("score").equals(1),"crossing scores");check(before.equals(next.toString()),"observer cannot mutate the supplied native snapshot through the API");
  runtime.advance(state(150,4.5));check(runtime.mode().equals("disabled")&&runtime.remaining()==0,"end disables");check(runtime.events(1).size()==1,"event cursor");
  rejects(()->runtime.start(first,JSON.createObjectNode()),"second start");
  var f=new SeasonFrame(first,Set.of("practice-piece"),.01);check(f.position("practice-piece").x()==0&&f.velocity("practice-piece").x()==3,"read-only SI observations");
  try{f.bodyIds().clear();throw new AssertionError("Mutable observation selection");}catch(UnsupportedOperationException expected){}
  rejects(()->f.position("unlisted"),"undeclared body");
  var active=new MatchRuntime(world);active.start(first,JSON.createObjectNode());active.advance(state(10,0));rejects(()->active.advance(state(9,0)),"clock regression");active.abort("operator stop");check(active.mode().equals("disabled"),"abort disables");
 }
 static void configurationErrors()throws Exception{
  var w=world();((ObjectNode)w.path("season")).put("adapter","not.installed");rejects(()->new MatchRuntime(w),"unknown plugin");
  var ambiguous=world();ambiguous.set("rebuilt2026",JSON.createObjectNode());rejects(()->new MatchRuntime(ambiguous),"ambiguous selection");
  var badBodies=world();((ArrayNode)badBodies.path("season").path("config").path("bodies")).add("missing");rejects(()->new MatchRuntime(badBodies),"unknown observation");
  var empty=world();empty.remove("season");var noSeason=new MatchRuntime(empty);check(noSeason.mode().equals("disabled")&&noSeason.snapshot().get("phase").equals("unavailable"),"no rules inferred");
  SeasonPlugin incompatible=new SeasonPlugin(){public String id(){return "wrong.api";}public int apiVersion(){return 2;}public SeasonObserver create(JsonNode world,JsonNode config){throw new AssertionError();}};
  rejects(()->new MatchRuntime(empty,List.of(incompatible)),"unsupported plugin API");rejects(()->new MatchRuntime(empty,List.of(new RebuiltSeason.Plugin())),"duplicate provider");
  SeasonPlugin stubborn=new SeasonPlugin(){public String id(){return "stubborn";}public SeasonObserver create(JsonNode w,JsonNode c){return new SeasonObserver(){
   boolean started;public Set<String> observedBodies(){return Set.of();}public void start(SeasonFrame f,JsonNode o){started=true;}public void advance(SeasonFrame f){}public void abort(String reason){}
   public boolean started(){return started;}public boolean finished(){return false;}public Mode mode(){return Mode.TELEOP;}public double remaining(){return 10;}public Map<String,Object> snapshot(){return Map.of();}
  };}};
  var selected=world();((ObjectNode)selected.path("season")).put("adapter","stubborn");var guarded=new MatchRuntime(selected,List.of(stubborn));guarded.start(state(0,0),JSON.createObjectNode());guarded.abort("stop");check(guarded.mode().equals("disabled")&&guarded.remaining()==0,"runtime enforces abort even if a custom observer forgets to disable");
 }
 static JsonNode request(BufferedWriter input,BufferedReader output,JsonNode request)throws Exception{input.write(request.toString());input.newLine();input.flush();String line=output.readLine();if(line==null)throw new AssertionError("Native engine exited");var result=JSON.readTree(line);check(result.path("ok").asBoolean(),result.toString());return result.path("state");}
 static void nativeIntegration(String binary)throws Exception{
  var world=world();Process nativeProcess=new ProcessBuilder(binary).redirectError(ProcessBuilder.Redirect.INHERIT).start();
  try(var input=new BufferedWriter(new OutputStreamWriter(nativeProcess.getOutputStream(),StandardCharsets.UTF_8));var output=new BufferedReader(new InputStreamReader(nativeProcess.getInputStream(),StandardCharsets.UTF_8))){
   var load=JSON.createObjectNode().put("op","load");load.set("world",world);var first=request(input,output,load);var runtime=new MatchRuntime(world);runtime.start(first,JSON.createObjectNode());
   JsonNode state=first;for(int i=0;i<151;i++){state=request(input,output,JSON.createObjectNode().put("op","step"));runtime.advance(state);}
   check(state.path("bodies").path("practice-piece").path("position").get(0).asDouble()>4.4,"native body actually moved");check(runtime.snapshot().get("score").equals(1)&&runtime.mode().equals("disabled"),"native snapshots drive external scoring provider");
   System.out.println("Native + external season: 151 steps, crossing scored once, timed completion disabled");
  }finally{nativeProcess.destroy();if(!nativeProcess.waitFor(3,TimeUnit.SECONDS))nativeProcess.destroyForcibly();}
 }
 public static void main(String[] args)throws Exception{discoveryAndRules();configurationErrors();if(args.length!=1)throw new IllegalArgumentException("Pass native simulator binary");nativeIntegration(args[0]);System.out.println("Season plugins: discovery, API/ID/config validation, observations, lifecycle, native integration passed");}
}
