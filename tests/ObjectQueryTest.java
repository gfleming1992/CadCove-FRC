package org.instantcad.frc;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;

public final class ObjectQueryTest {
  private static void check(boolean value,String message) { if(!value)throw new AssertionError(message); }
  public static void main(String[] args)throws Exception {
    var json=new ObjectMapper();
    var state=json.createObjectNode().put("tick",42).put("time",.21);
    var bodies=state.putObject("bodies");
    for(int i=299;i>=0;i--)bodies.putObject("fuel/"+i).putArray("position").add(i).add(0).add(0);
    bodies.putObject("chassis").putArray("position").add(3).add(4).add(0);
    bodies.putObject("id+with space").putArray("position").add(0).add(0).add(0);
    String unchanged=state.toString();
    var exact=ObjectQuery.select(state,"id=chassis&id=id%2Bwith+space");
    check(exact.path("objects").size()==2&&exact.path("tick").asInt()==42&&exact.path("time").asDouble()==.21,"exact IDs and snapshot identity");
    ((ObjectNode)exact.path("objects").path("chassis")).put("position",999);
    check(state.toString().equals(unchanged),"query result mutated source snapshot");
    var near=ObjectQuery.select(state,"id=chassis&prefix=fuel%2F&near=0,0,0&radius=5&limit=10");
    check(near.path("totalMatched").asInt()==7&&near.path("objects").has("chassis")&&near.path("objects").has("fuel/5")&&!near.path("objects").has("fuel/6"),"union selectors and inclusive Euclidean radius");
    Set<String> all=new LinkedHashSet<>();String after=null;int pages=0;
    do {
      var page=ObjectQuery.select(state,"prefix=fuel%2F&limit=37"+(after==null?"":"&after="+URLEncoder.encode(after,StandardCharsets.UTF_8)));
      check(page.path("totalMatched").asInt()==300&&page.path("objects").size()<=37,"bounded page");
      var names=page.path("objects").fieldNames();while(names.hasNext())check(all.add(names.next()),"duplicate across pages");
      after=page.path("nextAfter").isNull()?null:page.path("nextAfter").asText();pages++;
      check(pages<=9,"pagination did not terminate");
    }while(after!=null);
    check(all.size()==300&&pages==9,"pagination omitted objects");
    check(ObjectQuery.select(state,null).path("objects").size()==64,"default bound");
    check(ObjectQuery.select(state,"prefix=missing/").path("objects").isEmpty(),"empty prefix result");
    check(ObjectQuery.select(state,"after=zzzz").path("nextAfter").isNull(),"past-end page");
    for(String query:List.of("id=missing","id=", "limit=0","limit=257","limit=1.2","limit=1&limit=2",
        "prefix=fuel&prefix=other","other=1","near=0,0,0","radius=1","near=0,0&radius=1",
        "near=0,0,0&radius=NaN","near=Infinity,0,0&radius=1","near=0,0,0&radius=0",
        "near=0,0,0&radius=1001","id=%XX","broken","limit=1&","id="+"x".repeat(4097))) {
      try {ObjectQuery.select(state,query);throw new AssertionError("accepted invalid query: "+query);}
      catch(IllegalArgumentException expected){}
    }
    check(state.toString().equals(unchanged),"queries modified source state");
    System.out.println("ObjectQueryTest passed: identity, nonmutation, spatial selection, pagination, validation");
  }
}
