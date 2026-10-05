package org.instantcad.frc;

import com.fasterxml.jackson.databind.JsonNode;

/** Unit conversion at the device boundary. Missing feedback must never become zero. */
final class DeviceMath {
  private DeviceMath() {}
  static double number(JsonNode object,String key) {return finite(object.path(key),key);}
  private static double finite(JsonNode value,String label) {
    if(!value.isNumber()||!Double.isFinite(value.doubleValue()))throw new IllegalArgumentException("Invalid numeric device feedback: "+label);
    return value.doubleValue();
  }
  static double[] vector(JsonNode object,String key,int size) {
    var value=object.path(key);
    if(!value.isArray()||value.size()!=size)throw new IllegalArgumentException("Invalid device feedback vector: "+key);
    var result=new double[size];for(int i=0;i<size;i++)result[i]=finite(value.get(i),key+"["+i+"]");return result;
  }
  record EncoderScale(double turnsPerUnit,double offsetTurns,boolean inverted) {
    EncoderScale {
      if(!Double.isFinite(turnsPerUnit)||turnsPerUnit<=0||!Double.isFinite(offsetTurns))throw new IllegalArgumentException("Encoder requires positive finite turns per unit and finite offset turns");
    }
    MotorAdapter.Feedback convert(JsonNode joint) {
      double sign=inverted?-1:1;
      return new MotorAdapter.Feedback(sign*(number(joint,"position")*turnsPerUnit-offsetTurns),sign*number(joint,"velocity")*turnsPerUnit);
    }
  }
  static double yawDegrees(JsonNode body) {
    var q=vector(body,"quaternion",4);double norm=0;for(double v:q)norm+=v*v;
    if(Math.abs(norm-1)>0.01)throw new IllegalArgumentException("Device feedback quaternion is not normalized");
    double x=q[0],y=q[1],z=q[2],w=q[3];
    return Math.toDegrees(Math.atan2(2*(w*z+x*y),1-2*(y*y+z*z)));
  }
}
