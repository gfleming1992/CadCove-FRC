package org.instantcad.frc;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
public final class StateDeltaTest {
  public static void main(String[] args)throws Exception {
    var json=new ObjectMapper();
    var old=json.readTree("{\"tick\":1,\"bodies\":{\"a\":{\"x\":0},\"b\":{\"x\":1}},\"contacts\":[],\"motors\":{\"m\":1}}");
    String unchanged=old.toString();
    var delta=json.readTree("{\"baseTick\":1,\"removedBodies\":[\"b\"],\"state\":{\"tick\":2,\"bodies\":{\"a\":{\"x\":2},\"c\":{\"x\":3}},\"motors\":{\"m\":2}}}");
    var next=TwinBridge.applyStateDelta(old,delta);
    var expected=json.readTree("{\"tick\":2,\"bodies\":{\"a\":{\"x\":2},\"c\":{\"x\":3}},\"contacts\":[],\"motors\":{\"m\":2}}");
    if(!next.equals(expected)||!old.toString().equals(unchanged))throw new AssertionError("state mismatch or old snapshot mutated");
    for(var baseline:new com.fasterxml.jackson.databind.JsonNode[]{null,next}){
      try{TwinBridge.applyStateDelta(baseline,delta);throw new AssertionError("invalid baseline accepted");}
      catch(IOException expectedFailure){}
    }
    System.out.println("StateDeltaTest passed");
  }
}
