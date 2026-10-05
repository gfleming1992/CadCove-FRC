package org.instantcad.frc;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.util.*;

/** The same test executable runs against the pre-plugin and current bridge. */
public final class SeasonCompatibilityTest {
 static final ObjectMapper JSON=new ObjectMapper().configure(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS,true);
 static ObjectNode state(long tick,double z){var s=JSON.createObjectNode().put("tick",tick);s.putObject("bodies").putObject("fuel/a").putArray("position").add(0).add(0).add(z);return s;}
 public static void main(String[] args)throws Exception{
  ObjectNode world=JSON.createObjectNode().put("dt",.005);world.putArray("bodies").addObject().put("id","fuel/a").putArray("colliders").addObject().put("kind","ball").put("radius",.1);
  var rules=world.putObject("rebuilt2026").put("schema",1).put("season",2026);var hubs=rules.putArray("hubs");
  for(String side:List.of("blue","red")){
   double x=side.equals("blue")?0:10;var hub=hubs.addObject().put("side",side).put("topZ",2);hub.putArray("center").add(x).add(0).add(2);var opening=hub.putArray("opening");
   for(int i=0;i<6;i++)opening.addObject().put("x",Math.cos(i*Math.PI/3)).put("y",Math.sin(i*Math.PI/3)).put("offset",1);
   var beams=hub.putArray("beams");for(int i=0;i<4;i++){var beam=beams.addObject().put("id","beam"+i);beam.putArray("a").add(x-1).add(0).add(1);beam.putArray("b").add(x+1).add(0).add(1);}
  }
  var runtime=new MatchRuntime(world);runtime.start(state(0,3),"blue");var samples=new ArrayList<Object>();
  for(long tick:new long[]{200,4000,4600,6600,11600,16600,21600,26600,32600,33200,40000}){
   runtime.advance(state(tick,0));var snapshot=new TreeMap<>(runtime.snapshot());snapshot.remove("adapter");snapshot.remove("adapterApiVersion");snapshot.remove("availableAdapters");samples.add(Map.of("snapshot",snapshot,"mode",runtime.mode(),"remaining",runtime.remaining(),"events",runtime.events(0)));
  }
  System.out.println(JSON.writeValueAsString(samples));
 }
}
