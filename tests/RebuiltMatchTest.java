package org.instantcad.frc;
import java.util.*;
public final class RebuiltMatchTest {
 static void check(boolean value,String label){if(!value)throw new AssertionError(label);}
 static RebuiltMatch.Hub hub(String side,double x,double beamZ){
  var planes=new ArrayList<RebuiltMatch.Plane>();for(int i=0;i<6;i++)planes.add(new RebuiltMatch.Plane(Math.cos(i*Math.PI/3),Math.sin(i*Math.PI/3),1));
  return new RebuiltMatch.Hub(side,new RebuiltMatch.Vec(x,0,2),2,planes,List.of(new RebuiltMatch.Beam("sensor",new RebuiltMatch.Vec(x-1,0,beamZ),new RebuiltMatch.Vec(x+1,0,beamZ))));
 }
 static RebuiltMatch make(){return new RebuiltMatch(List.of(hub("blue",0,1),hub("red",10,1)));}
 static RebuiltMatch.Fuel fuel(String id,double x,double z){return new RebuiltMatch.Fuel(id,new RebuiltMatch.Vec(x,0,z),.1);}
 static int count(RebuiltMatch m,String field,String side){return (Integer)((Map<?,?>)m.snapshot().get(field)).get(side);}
 static void clock(){
  var m=make();m.start(100,"red",List.of());
  double[] times={0,20,23,33,58,83,108,133,163,166};String[] phases={"auto","auto_assessment","transition","shift_1","shift_2","shift_3","shift_4","endgame","final_assessment","complete"};
  for(int i=0;i<times.length;i++){m.advance(100+times[i],List.of());check(m.phase().equals(phases[i]),"phase "+times[i]);if(times[i]==33)check(m.hubActive("blue")&&!m.hubActive("red"),"first inactive from tie");if(times[i]==58)check(m.hubActive("red")&&!m.hubActive("blue"),"alternate hubs");}
  m.advance(400,List.of());check(m.elapsed()==166,"completed clock freezes");check(m.mode().equals("disabled"),"completed robot disabled");
 }
 static void ordering(){
  var m=make();m.start(0,"red",List.of(fuel("b",0,3),fuel("r",10,3)));
  m.advance(22.999,List.of(fuel("r",10,1.1003),fuel("b",0,1.1001)));
  m.advance(23.001,List.of(fuel("r",10,1.0999),fuel("b",0,1.0997)));
  check(count(m,"autoFuel","blue")==1&&count(m,"autoFuel","red")==0,"AUTO scores before boundary");
  check(count(m,"teleopFuel","red")==1,"later red passage belongs to teleop");check(m.gameData().equals("B"),"input order must not choose winner");
  m.advance(24,List.of(fuel("b",0,.9),fuel("r",10,.9)));check(count(m,"teleopFuel","red")==1,"no repeated sensor count");
 }
 static void passage(){
  var m=make();m.start(0,"red",List.of(fuel("good",0,3),fuel("miss",2,3),fuel("below",0,1.5)));
  m.advance(1,List.of(fuel("below",0,.5),fuel("miss",2,.5),fuel("good",0,.5)));
  check(count(m,"autoFuel","blue")==1,"top entry AND swept beam required");
  var wrong= new RebuiltMatch(List.of(hub("blue",0,2.2),hub("red",10,2.2)));
  wrong.start(0,"blue",List.of(fuel("b",0,3)));wrong.advance(1,List.of(fuel("b",0,0)));
  check(count(wrong,"autoFuel","blue")==0,"beam crossing before top entry excluded");
 }
 static void abort(){var m=make();m.start(0,"blue",List.of());m.advance(1,List.of());m.abort("test");m.advance(100,List.of());check(m.elapsed()==1&&m.mode().equals("disabled"),"abort freezes clock and disables");}
 static void grace(){
  for(double hit:new double[]{35,36.1}){
   var m=make();m.start(0,"blue",List.of(fuel("b",0,3)));m.advance(23,List.of(fuel("b",0,1.2)));m.advance(hit-.1,List.of(fuel("b",0,1.2)));m.advance(hit+.1,List.of(fuel("b",0,1)));
   check(count(m,hit<36?"teleopFuel":"inactiveFuel","blue")==1,"three second inactive grace "+hit);
  }
 }
 public static void main(String[] args){clock();ordering();passage();abort();grace();System.out.println("RebuiltMatch: clock, boundaries, chronological scoring, swept sensors, grace and abort passed");}
}
