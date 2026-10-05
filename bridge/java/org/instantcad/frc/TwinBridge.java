package org.instantcad.frc;

import com.ctre.phoenix6.hardware.TalonFX;
import com.ctre.phoenix6.hardware.CANcoder;
import com.ctre.phoenix6.hardware.Pigeon2;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import edu.wpi.first.wpilibj.RobotBase;
import edu.wpi.first.wpilibj.DriverStation;
import edu.wpi.first.wpilibj.simulation.DriverStationSim;
import edu.wpi.first.wpilibj.simulation.RoboRioSim;
import edu.wpi.first.wpilibj.simulation.SimHooks;
import edu.wpi.first.wpilibj.Timer;
import edu.wpi.first.hal.AllianceStationID;
import edu.wpi.first.networktables.NetworkTableInstance;
import com.sun.net.httpserver.HttpServer;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

/** Desktop-only Phoenix I/O bridge. Controls remain in the student's robot code. */
public final class TwinBridge {
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final Map<String,MotorAdapter> motors = new LinkedHashMap<>();
  private static final List<Map<String,Object>> devices = new ArrayList<>();
  private static final List<EncoderBinding> encoders = new ArrayList<>();
  private static Pigeon2 pigeon;
  private static String gyroBody="chassis";
  private static volatile JsonNode latest = JSON.createObjectNode();
  private record Input(JsonNode value,long received) {}
  private static volatile Input input = new Input(JSON.createObjectNode(),0);
  private static final Map<String,Long> inputSequences=new LinkedHashMap<>();
  private static volatile JsonNode telemetry = JSON.createObjectNode();
  private static final Map<String,Double> fieldVoltages = new LinkedHashMap<>();
  private static volatile double supplyVoltage=12.6, lastStepMs, maxStepMs;
  private static volatile long overruns;
  private static double[] initialPose={0,0,0};
  private static volatile String failure = "";
  private static volatile String appliedMode="disabled";
  private static volatile JsonNode matchSnapshot=JSON.createObjectNode();
  private static volatile JsonNode clockSnapshot=JSON.createObjectNode();
  private static final boolean bridgeProfile="1".equals(System.getenv("INSTANTCAD_BRIDGE_PROFILE"));
  private static volatile JsonNode tickTimings=JSON.createObjectNode();
  private static volatile JsonNode physicsPerformance=JSON.createObjectNode();
  // Exact state deltas reduce IPC work while retaining full-precision physics feedback.
  private static final boolean stateDelta=!"0".equals(System.getenv("INSTANTCAD_STATE_DELTA"));
  private static JsonNode transportState;
  private static int lastWireBytes;
  private static final boolean externalDriverStation="driverstation".equals(System.getenv("INSTANTCAD_CONTROL_SOURCE"));
  private static final boolean physicsClock="physics".equals(System.getenv("INSTANTCAD_CLOCK"));
  private static double clockOrigin;
  private static volatile double pace=1;
  private static long paceStart,paceTick;
  private static ScheduledExecutorService executor;
  private static GameplayPacing gameplayPacing;
  private static PhoenixSimulationEnable phoenixEnable;
  private static volatile long lastPhysicsProgress;
  private static Process physics;
  private static BufferedWriter writer;
  private static BufferedReader reader;
  private static long steps;
  private static HttpServer server;
  private static ManagedSession managedSession;
  private static void context(String name,com.sun.net.httpserver.HttpHandler handler){
    var context=server.createContext(name,handler);if(managedSession!=null)managedSession.protect(context,runId);
  }
  private static double physicsDt = 0.005;
  private static volatile boolean resetting;
  private static final boolean resetAllowed="1".equals(System.getenv("INSTANTCAD_ALLOW_RESET")) && System.getenv("INSTANTCAD_TRACE")==null;
  private static String runId = UUID.randomUUID().toString();
  private static String worldHash = "";
  private static InputTrace inputTrace;
  private static MatchRuntime match;
  private static SimVision vision;
  private static String autoChooserPath=System.getenv().getOrDefault("INSTANTCAD_AUTO_CHOOSER","");
  private record EncoderBinding(CANcoder device, String joint, DeviceMath.EncoderScale scale, boolean angularOnly) {}
  public static boolean enabled() { return RobotBase.isSimulation() && "1".equals(System.getenv("INSTANTCAD_SIM")); }

  public static synchronized void registerMotor(TalonFX device,String name,double rotorPerUnit,
      double inertia, boolean clockwise, String kind, double lower, double upper) {
    if(!enabled())return;
    int id=device.getDeviceID();
    registerMotor(device,"talon/"+id,clockwise);
    // All physical coordinates are authored CCW+/forward; Phoenix handles logical inversion.
    var d=devices.get(devices.size()-1);
    d.put("name",name);d.put("rotorPerUnit",rotorPerUnit);d.put("inertia",inertia);d.put("kind",kind);
    if(Double.isFinite(lower))d.put("lower",lower);if(Double.isFinite(upper))d.put("upper",upper);
  }
  /** Generic binding: ratios, mass and mechanism geometry belong in the world,
   * not in each team's motor wrapper. Identity need not encode a CAN number. */
  public static synchronized void registerMotor(TalonFX device,String physicalMotorId,boolean clockwise){
    if(!enabled())return;
    registerMotor(new PhoenixMotorAdapter(device,clockwise),physicalMotorId);
  }
  /** Extension point for other device families. The adapter wraps existing robot code. */
  public static synchronized void registerMotor(MotorAdapter adapter,String physicalMotorId){
    if(!enabled())return;
    if(executor!=null)throw new IllegalStateException("Register simulated devices before starting physics");
    Objects.requireNonNull(adapter,"Motor adapter");String endpoint=adapter.endpoint();
    if(endpoint==null||endpoint.isBlank())throw new IllegalArgumentException("Motor adapter needs a hardware endpoint");
    if(physicalMotorId==null||physicalMotorId.isBlank()||physicalMotorId.startsWith("field-drive/"))throw new IllegalArgumentException("Invalid robot motor identity");
    for(var existing:motors.values())if(existing==adapter||existing.endpoint().equals(endpoint))throw new IllegalStateException("Duplicate simulated endpoint: "+endpoint);
    if(motors.containsKey(physicalMotorId))throw new IllegalStateException("Duplicate physical motor identity: "+physicalMotorId);
    var d=new LinkedHashMap<String,Object>(adapter.description());d.put("id",physicalMotorId);d.put("endpoint",endpoint);
    motors.put(physicalMotorId,adapter);devices.add(d);
  }
  /** Angular joint in radians, offset in sensor turns, before inversion. */
  public static synchronized void registerEncoder(CANcoder device,String joint,double offset,boolean inverted){
    registerEncoder(device,joint,1/(2*Math.PI),offset,inverted,true);
  }
  /** Explicit sensor turns per native joint unit (radian or metre). */
  public static synchronized void registerEncoder(CANcoder device,String joint,double turnsPerUnit,double offsetTurns,boolean inverted){
    registerEncoder(device,joint,turnsPerUnit,offsetTurns,inverted,false);
  }
  private static void registerEncoder(CANcoder device,String joint,double turnsPerUnit,double offsetTurns,boolean inverted,boolean angularOnly){
    if(!enabled())return;
    if(executor!=null)throw new IllegalStateException("Register simulated devices before starting physics");
    Objects.requireNonNull(device,"Encoder");
    if(joint==null||joint.isBlank())throw new IllegalArgumentException("Encoder joint required");
    var scale=new DeviceMath.EncoderScale(turnsPerUnit,offsetTurns,inverted);
    for(var old:encoders)if(old.device()==device||(old.device().getDeviceID()==device.getDeviceID()&&old.device().getNetwork().getName().equals(device.getNetwork().getName())))throw new IllegalStateException("Duplicate simulated encoder endpoint");
    encoders.add(new EncoderBinding(device,joint,scale,angularOnly));
  }
  public static synchronized void registerGyro(Pigeon2 device){registerGyro(device,"chassis");}
  /** Level-mounted, Z-up yaw feedback. Other mounts require a calibrated adapter. */
  public static synchronized void registerGyro(Pigeon2 device,String physicalBodyId){
    if(!enabled())return;
    if(executor!=null)throw new IllegalStateException("Register simulated devices before starting physics");
    if(pigeon!=null)throw new IllegalStateException("Only one built-in gyro binding is supported");
    Objects.requireNonNull(device,"Gyro");
    if(physicalBodyId==null||physicalBodyId.isBlank())throw new IllegalArgumentException("Gyro body required");
    pigeon=device;gyroBody=physicalBodyId;
  }
  public static double[] initialPose(){return initialPose.clone();}
  public static void publishTelemetry(Map<String,Object> values){if(enabled())telemetry=JSON.valueToTree(values);}

  public static synchronized void start() {
    if(!enabled()||executor!=null)return;
    try {
      managedSession=ManagedSession.fromEnvironment();
      Runtime.getRuntime().addShutdownHook(new Thread(TwinBridge::stop));
      if(managedSession!=null)managedSession.watchLauncher(()->{
        System.err.println("CadCove launcher exited; stopping its owned robot simulation");
        System.exit(0);
      });
      String root=Objects.requireNonNull(System.getenv("INSTANTCAD_ROOT"),"INSTANTCAD_ROOT required");
      Path nativeBinary=Path.of(System.getenv().getOrDefault("INSTANTCAD_SIM_BINARY",root+"/target/release/instantcad-sim")).toAbsolutePath().normalize();
      if(!Files.isExecutable(nativeBinary))throw new IllegalStateException("Native simulator is not executable: "+nativeBinary);
      Path output=Path.of(System.getenv().getOrDefault("INSTANTCAD_BUILD",root+"/build"));Files.createDirectories(output);
      JSON.writerWithDefaultPrettyPrinter().writeValue(output.resolve("devices.json").toFile(),devices);
      String worldPath=System.getenv().getOrDefault("INSTANTCAD_WORLD",root+"/build/world.json");
      byte[] worldBytes=Files.readAllBytes(Path.of(worldPath));
      worldHash=HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(worldBytes));
      JsonNode world=JSON.readTree(worldBytes);
      match=new MatchRuntime(world);
      vision=new SimVision(world,NetworkTableInstance.getDefault());
      JsonNode fieldDrives=world.path("field_drives");
      if(!fieldDrives.isMissingNode()&&!fieldDrives.isObject())throw new IllegalArgumentException("field_drives must be an object");
      fieldDrives.fields().forEachRemaining(e->{
        double v=e.getValue().asDouble(Double.NaN);
        if(!e.getKey().startsWith("field-drive/")||!e.getValue().isNumber()||!Double.isFinite(v)||Math.abs(v)>12)throw new IllegalArgumentException("Invalid field drive "+e.getKey());
        fieldVoltages.put(e.getKey(),v);
      });
      Set<String> fieldBound=new HashSet<>();
      for(JsonNode body:world.path("bodies"))if(body.path("id").asText().equals("chassis"))initialPose=new double[]{body.path("position").get(0).asDouble(),body.path("position").get(1).asDouble(),body.path("rotation").path(2).asDouble()};
      for(JsonNode motor:world.path("motors")){
        String motorId=motor.path("id").asText();
        if(fieldVoltages.containsKey(motorId)){if(!fieldBound.add(motorId))throw new IllegalArgumentException("Duplicate field motor "+motorId);continue;}
        String id=motorId;
        MotorAdapter adapter=motors.get(id);if(adapter==null)throw new IllegalArgumentException("Unregistered world motor "+id);
        adapter.configure(motor.deepCopy());
      }
      physicsDt=world.path("dt").asDouble(0.005);
      if(!fieldBound.equals(fieldVoltages.keySet()))throw new IllegalArgumentException("Unbound field drive");
      Set<String> bound=new HashSet<>();world.path("motors").forEach(m->{String id=m.path("id").asText();if(!fieldBound.contains(id))bound.add(id);});
      for(String id:motors.keySet())if(!bound.contains(id))throw new IllegalStateException("World missing motor "+id+"; inspect devices.json in the configured build folder");
      if(bound.size()!=motors.size())throw new IllegalStateException("World/device motor count mismatch");
      Map<String,String> jointKinds=new HashMap<>();for(JsonNode joint:world.path("joints"))jointKinds.put(joint.path("id").asText(),joint.path("kind").asText());
      for(EncoderBinding encoder:encoders){
        String kind=jointKinds.get(encoder.joint());
        if(kind==null)throw new IllegalArgumentException("Encoder bound to missing joint "+encoder.joint());
        if(encoder.angularOnly()&&!kind.equals("revolute"))throw new IllegalArgumentException("Non-revolute encoder requires explicit turnsPerUnit: "+encoder.joint());
      }
      if(pigeon!=null){boolean found=false;for(JsonNode body:world.path("bodies"))if(body.path("id").asText().equals(gyroBody))found=true;if(!found)throw new IllegalArgumentException("Gyro bound to missing body "+gyroBody);}
      String tracePath=System.getenv("INSTANTCAD_TRACE");
      if(tracePath!=null&&!tracePath.isBlank()){
        String body=System.getenv().getOrDefault("INSTANTCAD_TRACE_BODY","chassis");
        boolean found=false;for(JsonNode b:world.path("bodies"))if(b.path("id").asText().equals(body))found=true;
        if(!found)throw new IllegalArgumentException("Unknown trace body "+body);
        inputTrace=new InputTrace(Path.of(tracePath),body,nativeBinary);
      }
      physics=new ProcessBuilder(nativeBinary.toString()).directory(new File(root)).redirectError(ProcessBuilder.Redirect.INHERIT).start();
      writer=new BufferedWriter(new OutputStreamWriter(physics.getOutputStream(),StandardCharsets.UTF_8));
      reader=new BufferedReader(new InputStreamReader(physics.getInputStream(),StandardCharsets.UTF_8));
      var load=JSON.createObjectNode().put("op","load");load.set("world",world);latest=exchange(load).path("state");
      if(physicsClock)SimHooks.pauseTiming();
      clockOrigin=Timer.getFPGATimestamp();
      if(!externalDriverStation){
      DriverStationSim.setDsAttached(true);DriverStationSim.setAllianceStationId(AllianceStationID.Blue1);
      for(int port=0;port<2;port++){DriverStationSim.setJoystickAxisCount(port,6);DriverStationSim.setJoystickButtonCount(port,10);DriverStationSim.setJoystickPOVCount(port,1);DriverStationSim.setJoystickIsXbox(port,true);DriverStationSim.setJoystickName(port,"InstantCAD Virtual Xbox "+port);DriverStationSim.setJoystickPOV(port,0,-1);}
      DriverStationSim.notifyNewData();
      }
      int bridgePort=Integer.parseInt(System.getenv().getOrDefault("INSTANTCAD_BRIDGE_PORT","8910"));
      if(bridgePort<0||bridgePort>65535||(bridgePort==0&&managedSession==null))throw new IllegalArgumentException("Invalid bridge port");
      server=HttpServer.create(new InetSocketAddress("127.0.0.1",bridgePort),0);
      matchSnapshot=JSON.valueToTree(match.snapshot());
      context("/state",e->{var response=JSON.createObjectNode().put("runId",runId).put("resetAvailable",resetAllowed&&!resetting).put("worldHash",worldHash).put("error",failure).put("batteryVolts",supplyVoltage).put("stepMs",lastStepMs).put("maxStepMs",maxStepMs).put("overruns",overruns).put("physicsDt",physicsDt).put("pace",pace).put("controlMode",appliedMode).put("controlSource",externalDriverStation?"driverstation":"agent");response.set("state",latest);response.set("robot",telemetry);response.set("match",matchSnapshot);response.set("clock",clockSnapshot);response.set("physicsPerformance",physicsPerformance);if(vision!=null)response.set("vision",vision.snapshot());if(bridgeProfile)response.set("tickTimings",tickTimings);respond(e,response);});
      context("/reset",e->{
        if(!e.getRequestMethod().equals("POST")){e.sendResponseHeaders(405,-1);e.close();return;}
        try {
          String origin=e.getRequestHeaders().getFirst("Origin");
          if(origin!=null&&!Set.of("http://127.0.0.1:8911","http://localhost:8911").contains(origin))throw new IllegalArgumentException("untrusted origin");
          byte[] bytes=e.getRequestBody().readNBytes(1025);if(bytes.length>1024)throw new IllegalArgumentException("request too large");
          JsonNode request=JSON.readTree(bytes);
          synchronized(TwinBridge.class){
            if(!resetAllowed||resetting)throw new IllegalStateException("Reset unavailable for this run");
            if(!runId.equals(request.path("runId").asText()))throw new IllegalArgumentException("Stale simulation run");
            resetting=true;input=new Input(JSON.createObjectNode().put("mode","disabled"),System.nanoTime());
            appliedMode="disabled";DriverStationSim.setEnabled(false);DriverStationSim.notifyNewData();
          }
          // Finish the HTTP acknowledgement before orderly shutdown. The owned
          // launcher starts a new JVM/native pair; no telemetry state is reused.
          try {respond(e,JSON.createObjectNode().put("ok",true).put("runId",runId));}
          finally {new Thread(()->System.exit(77),"TwinReset").start();}
        }catch(Exception ex){respondError(e,ex);}
      });
      context("/match",e->{
        try {
          if(e.getRequestMethod().equals("POST")){
            if(externalDriverStation)throw new IllegalStateException("Driver Station owns match control; restart in agent mode for scripted matches");
            String origin=e.getRequestHeaders().getFirst("Origin");if(origin!=null&&!Set.of("http://127.0.0.1:8911","http://localhost:8911").contains(origin))throw new IllegalArgumentException("untrusted origin");
            byte[] bytes=e.getRequestBody().readNBytes(1025);if(bytes.length>1024)throw new IllegalArgumentException("request too large");
            JsonNode c=JSON.readTree(bytes);
            synchronized(TwinBridge.class){
              switch(c.path("action").asText()){
                case "start" -> {if(!failure.isEmpty()||!DriverStation.isDisabled())throw new IllegalStateException("Disable robot before starting match");if(c.has("autonomous")&&!c.path("autonomous").asText().equals(autonomousSnapshot().path("active").asText()))throw new IllegalStateException("Autonomous selection has not been acknowledged by the robot chooser");match.start(latest,c.has("options")?c.get("options"):JSON.createObjectNode().put("tieWinner",c.path("tieWinner").asText()));input=new Input(JSON.createObjectNode().put("mode","match"),System.nanoTime());}
                case "abort" -> match.abort("requested");
                default -> throw new IllegalArgumentException("Unknown match action");
              }
            }
          }else if(!e.getRequestMethod().equals("GET")){e.sendResponseHeaders(405,-1);e.close();return;}
          long after=0;String query=e.getRequestURI().getRawQuery();if(query!=null){if(!query.matches("after=[0-9]+"))throw new IllegalArgumentException("Invalid cursor");after=Long.parseLong(query.substring(6));}
          var response=JSON.valueToTree(match.snapshot());((ObjectNode)response).set("events",JSON.valueToTree(match.events(after)));respond(e,response);
        }catch(Exception ex){respondError(e,ex);}
      });
      context("/devices",e->respond(e,JSON.valueToTree(devices)));
      context("/objects",e->{
        e.getResponseHeaders().set("Cache-Control","no-store");
        if(!e.getRequestMethod().equals("GET")){e.sendResponseHeaders(405,-1);e.close();return;}
        try {
          // Read the volatile snapshot once: all returned poses share this tick.
          var response=ObjectQuery.select(latest,e.getRequestURI().getRawQuery());
          response.put("runId",runId).put("worldHash",worldHash).put("error",failure);
          respond(e,response);
        }catch(Exception ex){respondError(e,ex);}
      });
      // Read-only host-side requests explain why a mechanism is unpowered or
      // holding a setpoint. This is not a firmware acknowledgement or an atomic
      // physics snapshot; keep acquisition off the 200 Hz stepping path.
      context("/motor-controls",e->{
        if(!e.getRequestMethod().equals("GET")){e.sendResponseHeaders(405,-1);e.close();return;}
        try {
          var response=JSON.createObjectNode().put("runId",runId).put("worldHash",worldHash)
              .put("observation","asynchronous host-side applied requests").put("tickBefore",latest.path("tick").asLong());
          var controls=response.putObject("motors");
          for(var entry:motors.entrySet()){
            controls.set(entry.getKey(),JSON.valueToTree(entry.getValue().appliedControl()));
          }
          response.put("tickAfter",latest.path("tick").asLong());respond(e,response);
        }catch(Exception ex){respondError(e,ex);}
      });
      context("/autonomous",e->{
        try{
          if(e.getRequestMethod().equals("POST")){
            if(externalDriverStation)throw new IllegalStateException("Driver Station owns match control; restart in agent mode for scripted matches");
            String origin=e.getRequestHeaders().getFirst("Origin");if(origin!=null&&!Set.of("http://127.0.0.1:8911","http://localhost:8911").contains(origin))throw new IllegalArgumentException("untrusted origin");
            byte[] bytes=e.getRequestBody().readNBytes(1025);if(bytes.length>1024)throw new IllegalArgumentException("request too large");
            String selection=JSON.readTree(bytes).path("selection").asText();
            synchronized(TwinBridge.class){
              if(!DriverStation.isDisabled()||match.started())throw new IllegalStateException("Select autonomous in a fresh disabled simulation");
              JsonNode snapshot=autonomousSnapshot();boolean found=false;for(JsonNode option:snapshot.path("options"))if(option.asText().equals(selection))found=true;
              if(!found)throw new IllegalArgumentException("Unknown autonomous selection");
              NetworkTableInstance.getDefault().getTable(autoChooserPath).getEntry("selected").setString(selection);
            }
          }else if(!e.getRequestMethod().equals("GET")){e.sendResponseHeaders(405,-1);e.close();return;}
          respond(e,autonomousSnapshot());
        }catch(Exception ex){respondError(e,ex);}
      });
      context("/controls",e->{
        if(!e.getRequestMethod().equals("POST")){e.sendResponseHeaders(405,-1);e.close();return;}
        try {String origin=e.getRequestHeaders().getFirst("Origin");if(origin!=null&&!origin.equals("http://127.0.0.1:8911")&&!origin.equals("http://localhost:8911"))throw new IllegalArgumentException("untrusted control origin");
          byte[] bytes=e.getRequestBody().readNBytes(16385);if(bytes.length>16384)throw new IllegalArgumentException("input too large");
          JsonNode c=JSON.readTree(bytes);validateControls(c);acceptControls(c);respond(e,JSON.createObjectNode().put("ok",true));
        }catch(Exception ex){e.sendResponseHeaders(400,-1);e.close();}
      });
      if(managedSession!=null)context("/shutdown",e->{
        if(!e.getRequestMethod().equals("POST")){e.sendResponseHeaders(405,-1);e.close();return;}
        resetting=true;input=new Input(JSON.createObjectNode().put("mode","disabled"),System.nanoTime());
        appliedMode="disabled";DriverStationSim.setEnabled(false);DriverStationSim.notifyNewData();
        try{respond(e,JSON.createObjectNode().put("ok",true).put("runId",runId));}
        finally{new Thread(()->System.exit(0),"CadCoveStop").start();}
      });
      server.setExecutor(Executors.newCachedThreadPool(r->{Thread t=new Thread(r,"TwinHttp");t.setDaemon(true);return t;}));server.start();
      lastPhysicsProgress=System.nanoTime();
      if(physicsClock)phoenixEnable=new PhoenixSimulationEnable(()->{
        Input packet=input;long now=System.nanoTime();
        return failure.isEmpty()&&now-lastPhysicsProgress<1_000_000_000L
            &&(externalDriverStation?DriverStation.isDSAttached():now-packet.received()<1_000_000_000L
            &&!packet.value().path("mode").asText("disabled").equals("disabled"))
            &&!appliedMode.equals("disabled")&&DriverStation.isEnabled()&&!DriverStation.isEStopped();
      });
      executor=Executors.newSingleThreadScheduledExecutor(r->{Thread t=new Thread(r,"TwinPhysics");t.setDaemon(true);return t;});
      if(world.hasNonNull("gameplay")){gameplayPacing=new GameplayPacing(Math.round(physicsDt*1e9));executor.execute(TwinBridge::gameplayTick);}
      else executor.scheduleAtFixedRate(TwinBridge::tick,0,Math.round(physicsDt*1e9),TimeUnit.NANOSECONDS);
      if(managedSession!=null)managedSession.publish(server.getAddress().getPort(),runId,worldHash);
      System.out.println("INSTANTCAD_READY "+runId+" motors="+motors.size());
    } catch(Exception e) {failure=e.toString();DriverStationSim.setEnabled(false);e.printStackTrace();}
  }
  private static JsonNode exchange(JsonNode command)throws IOException {
    String input=command.toString();writer.write(input);writer.newLine();writer.flush();String line=reader.readLine();
    if(line==null)throw new EOFException("Physics runner exited");JsonNode r=JSON.readTree(line);
    if(!r.path("ok").asBoolean())throw new IOException(r.path("error").asText());
    if(bridgeProfile)lastWireBytes=line.getBytes(StandardCharsets.UTF_8).length+1;
    if(r.has("stateDelta")){
      ((ObjectNode)r).set("state",applyStateDelta(transportState,r.path("stateDelta")));
    }
    if(r.has("state"))transportState=r.path("state");
    // Pure inspection queries do not belong in the dynamics replay stream.
    if(inputTrace!=null&&r.has("state"))inputTrace.record(input,r);return r;
  }
  static JsonNode applyStateDelta(JsonNode previous,JsonNode delta)throws IOException {
    if(previous==null||delta.path("baseTick").asLong(-1)!=previous.path("tick").asLong())throw new IOException("Native state delta baseline mismatch");
    // Copy containers only. Published prior states remain immutable for HTTP readers.
    ObjectNode next=JSON.createObjectNode().setAll((ObjectNode)previous);
    ObjectNode bodies=JSON.createObjectNode().setAll((ObjectNode)previous.path("bodies"));
    bodies.setAll((ObjectNode)delta.path("state").path("bodies"));
    for(JsonNode id:delta.path("removedBodies"))bodies.remove(id.asText());
    next.setAll((ObjectNode)delta.path("state"));next.set("bodies",bodies);
    return next;
  }
  /** Opt-in exact native input recording; does not reschedule or replace robot controls. */
  private static final class InputTrace implements AutoCloseable {
    private final BufferedWriter output;
    private final String body;
    private long commands;
    private boolean closed;
    InputTrace(Path path,String body,Path binary)throws Exception{
      this.body=body;Files.createDirectories(path.toAbsolutePath().getParent());
      String binaryHash=HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(binary)));
      output=Files.newBufferedWriter(path,StandardCharsets.UTF_8,StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE);
      write(JSON.createObjectNode().put("type","header").put("schema",1).put("runId",runId).put("worldSourceSha256",worldHash).put("nativeSha256",binaryHash).put("body",body));output.flush();
    }
    private void write(JsonNode value)throws IOException{output.write(value.toString());output.newLine();}
    synchronized void record(String input,JsonNode response)throws IOException{
      if(closed)return;
      var record=JSON.createObjectNode().put("type","command").put("sequence",commands++).put("inputJson",input);
      var state=response.path("state");record.put("tick",state.path("tick").asLong());record.set("expectedBody",state.path("bodies").path(body));
      write(record);if(commands%200==0)output.flush();
    }
    public synchronized void close()throws IOException{
      if(closed)return;closed=true;write(JSON.createObjectNode().put("type","end").put("commands",commands));output.close();
    }
  }
  private static void gameplayTick() {
    long started=System.nanoTime();tick();
    ScheduledExecutorService loop=executor;
    if(loop==null||loop.isShutdown()||!failure.isEmpty())return;
    long delay=gameplayPacing.afterStep(started,System.nanoTime());
    try {loop.schedule(TwinBridge::gameplayTick,delay,TimeUnit.NANOSECONDS);}
    catch(RejectedExecutionException ignored) {/* Shutdown raced the next schedule. */}
  }
  private static synchronized void tick() {
    long started=System.nanoTime();
    try {
      if(!failure.isEmpty())return;
      // simulationInit must return before waiting for the robot's Notifier.
      if(physicsClock&&!SimHooks.getProgramStarted())return;
      // Refresh at the first physics boundary at/after each 20 ms input deadline.
      // Fractional ratios (12.5 or 15 ms) must not accumulate polling drift.
      if(steps==0||Math.floor(steps*physicsDt/0.020+1e-9)>
          Math.floor((steps-1)*physicsDt/0.020+1e-9)||match.started())applyControls();
      double supply=supplyVoltage;
      var cmd=JSON.createObjectNode().put("op","step");if(stateDelta)cmd.put("state_delta",true);var volts=cmd.putObject("volts");
      // Field machinery has its own power supply; it must not be mistaken for
      // a robot CAN device or charged against the robot battery model.
      fieldVoltages.forEach(volts::put);
      var coast=cmd.putArray("coast");double totalCurrent=0;
      for(var e:motors.entrySet()){var command=e.getValue().sample(supply);volts.put(e.getKey(),appliedMode.equals("disabled")||DriverStation.isDisabled()?0:command.volts());totalCurrent+=command.supplyCurrent();if(DriverStation.isDisabled()&&command.coastWhenDisabled())coast.add(e.getKey());}
      long prepared=bridgeProfile?System.nanoTime():0;
      JsonNode reply=exchange(cmd),state=reply.path("state");
      if(reply.has("performance"))physicsPerformance=reply.get("performance");
      int stepWireBytes=lastWireBytes;
      long exchanged=bridgeProfile?System.nanoTime():0;
      for(var e:motors.entrySet()){var m=state.path("motors").path(e.getKey());e.getValue().feedback(new MotorAdapter.Feedback(DeviceMath.number(m,"rotor_turns"),DeviceMath.number(m,"rotor_rps")));}
      for(var e:encoders){var feedback=e.scale().convert(state.path("joints").path(e.joint()));var sim=e.device().getSimState();sim.setSupplyVoltage(supply);sim.setRawPosition(feedback.rotorTurns());sim.setVelocity(feedback.rotorRps());}
      if(pigeon!=null){var body=state.path("bodies").path(gyroBody);double yaw=DeviceMath.yawDegrees(body),rate=DeviceMath.vector(body,"angular_velocity",3)[2];var sim=pigeon.getSimState();sim.setSupplyVoltage(supply);sim.setRawYaw(yaw);sim.setAngularVelocityZ(Math.toDegrees(rate));}
      // Explicit provisional battery model: 12.6 V open circuit, 20 milliohm pack+wiring.
      supplyVoltage=Math.max(6.0,12.6-0.020*totalCurrent);
      RoboRioSim.setVInVoltage(supplyVoltage);match.advance(state);
      double sensorNow=physicsClock?clockOrigin+state.path("tick").asLong()*physicsDt:Timer.getFPGATimestamp();
      long visionStarted=bridgeProfile?System.nanoTime():0;
      if(vision!=null)vision.tick(state,sensorNow,TwinBridge::exchange);
      double visionMs=bridgeProfile?(System.nanoTime()-visionStarted)/1e6:0;
      long feedback=bridgeProfile?System.nanoTime():0;
      if(physicsClock)SimHooks.stepTiming(physicsDt);
      long callbacks=bridgeProfile?System.nanoTime():0;
      double robotTime=Timer.getFPGATimestamp()-clockOrigin,physicalTime=state.path("tick").asLong()*physicsDt;
      clockSnapshot=JSON.createObjectNode().put("mode",physicsClock?"physics":"wall").put("tick",state.path("tick").asLong()).put("robotSeconds",robotTime).put("physicsSeconds",physicalTime).put("skewSeconds",robotTime-physicalTime);
      matchSnapshot=JSON.valueToTree(match.snapshot());latest=state;steps++;lastPhysicsProgress=System.nanoTime();
      long now=System.nanoTime();if(paceStart==0){paceStart=now;paceTick=steps;}else if(now-paceStart>=1_000_000_000L){pace=(steps-paceTick)*physicsDt/((now-paceStart)/1e9);paceStart=now;paceTick=steps;}
      lastStepMs=(System.nanoTime()-started)/1e6;maxStepMs=Math.max(maxStepMs,lastStepMs);if(lastStepMs>physicsDt*1000)overruns++;
      if(bridgeProfile)tickTimings=JSON.createObjectNode().put("tick",state.path("tick").asLong()).put("wireBytes",stepWireBytes).put("visionMs",visionMs)
          .put("prepareMs",(prepared-started)/1e6).put("exchangeMs",(exchanged-prepared)/1e6)
          .put("nativePhysicsMs",reply.path("physicsMs").asDouble())
          .put("feedbackAndMatchMs",(feedback-exchanged)/1e6)
          .put("robotCallbacksMs",(callbacks-feedback)/1e6)
          .put("publishMs",lastStepMs-(callbacks-started)/1e6).put("totalMs",lastStepMs);
    }catch(Exception e){failure=e.toString();DriverStationSim.setEnabled(false);DriverStationSim.notifyNewData();e.printStackTrace();}
  }
  private static void validateControls(JsonNode c) {
    if(!c.isObject())throw new IllegalArgumentException();
    if(c.has("controlStream")||c.has("sequence")){
      if(!c.path("controlStream").isTextual()||!c.path("controlStream").asText().matches("[A-Za-z0-9-]{1,64}")||!c.path("sequence").isIntegralNumber()||!c.path("sequence").canConvertToLong()||c.path("sequence").asLong()<1)throw new IllegalArgumentException("Invalid controller sequence");
    }
    if(!Set.of("disabled","teleop","autonomous","test","match").contains(c.path("mode").asText("disabled")))throw new IllegalArgumentException();
    if(c.has("matchTime")&&(!c.get("matchTime").isNumber()||!Double.isFinite(c.get("matchTime").asDouble())||c.get("matchTime").asDouble() < -1))throw new IllegalArgumentException();
    if(c.has("controllers")&&(!c.get("controllers").isArray()||c.get("controllers").size()>2))throw new IllegalArgumentException();
    Set<Integer> seen=new HashSet<>();
    for(JsonNode controller:c.path("controllers")){int port=controller.path("port").asInt(-1);if(!controller.path("port").isIntegralNumber()||port<0||port>1||!seen.add(port))throw new IllegalArgumentException();
      if(controller.has("axes")&&(!controller.get("axes").isArray()||controller.get("axes").size()>6))throw new IllegalArgumentException();for(JsonNode a:controller.path("axes"))if(!a.isNumber()||!Double.isFinite(a.asDouble())||Math.abs(a.asDouble())>1)throw new IllegalArgumentException();
      if(controller.has("buttons")&&(!controller.get("buttons").isIntegralNumber()||controller.get("buttons").asLong()<0||controller.get("buttons").asLong()>1023))throw new IllegalArgumentException();
      if(controller.has("pov")&&(!controller.get("pov").isIntegralNumber()||!Set.of(-1,0,45,90,135,180,225,270,315).contains(controller.get("pov").asInt())))throw new IllegalArgumentException();}
  }
  private static void acceptControls(JsonNode c){
    if(externalDriverStation)throw new IllegalStateException("Driver Station owns robot input; restart in agent mode for scripted controls");
    synchronized(inputSequences){
      if(resetting||c.has("runId")&&!runId.equals(c.path("runId").asText()))throw new IllegalArgumentException("Stale simulation run");
      if(c.has("controlStream")){
        String id=c.path("controlStream").asText();long sequence=c.path("sequence").asLong();
        if(sequence<=inputSequences.getOrDefault(id,0L))return;
        if(!inputSequences.containsKey(id)&&inputSequences.size()>=64)throw new IllegalArgumentException("Controller stream limit reached; restart simulation");
        inputSequences.put(id,sequence);
      }
      input=new Input(c,System.nanoTime());
    }
  }
  private static void applyControls() {
    if(externalDriverStation){
      // Read the standard WPILib control word. Do not publish virtual joystick
      // packets or touch enable state: the GUI/socket owns those, including E-stop.
      appliedMode=resetting||!DriverStation.isDSAttached()||DriverStation.isDisabled()||DriverStation.isEStopped()?"disabled":DriverStation.isAutonomous()?"autonomous":DriverStation.isTest()?"test":"teleop";
      return;
    }
    Input packet=input;JsonNode c=packet.value();boolean fresh=System.nanoTime()-packet.received()<1_000_000_000L;
    String requested=fresh&&!resetting?c.path("mode").asText("disabled"):"disabled";
    boolean scheduled=match.started()&&requested.equals("match");
    if(match.started()&&!scheduled)match.abort(!fresh?"controller lease expired":"manual takeover");
    String mode=scheduled?match.mode():requested.equals("match")?"disabled":requested;
    appliedMode=mode;
    DriverStationSim.setEnabled(!mode.equals("disabled"));DriverStationSim.setAutonomous(mode.equals("autonomous"));DriverStationSim.setTest(mode.equals("test"));DriverStationSim.setMatchTime(scheduled?match.remaining():c.path("matchTime").asDouble(-1));
    DriverStationSim.setGameSpecificMessage(scheduled?match.gameData():"");
    for(int port=0;port<2;port++){for(int axis=0;axis<6;axis++)DriverStationSim.setJoystickAxis(port,axis,0);DriverStationSim.setJoystickButtons(port,0);DriverStationSim.setJoystickPOV(port,0,-1);}
    if(fresh&&!mode.equals("disabled")&&(!scheduled||mode.equals("teleop")))for(JsonNode controller:c.path("controllers")){int port=controller.path("port").asInt();int axis=0;for(JsonNode v:controller.path("axes"))DriverStationSim.setJoystickAxis(port,axis++,v.asDouble());DriverStationSim.setJoystickButtons(port,controller.path("buttons").asInt());DriverStationSim.setJoystickPOV(port,0,controller.path("pov").asInt(-1));}
    DriverStationSim.notifyNewData();
  }
  private static void respond(com.sun.net.httpserver.HttpExchange e,JsonNode value)throws IOException {byte[] bytes=value.toString().getBytes(StandardCharsets.UTF_8);e.getResponseHeaders().set("Content-Type","application/json");e.sendResponseHeaders(200,bytes.length);e.getResponseBody().write(bytes);e.close();}
  private static ObjectNode autonomousSnapshot(){
    var result=JSON.createObjectNode().put("configured",!autoChooserPath.isBlank());
    if(autoChooserPath.isBlank())return result;
    var table=NetworkTableInstance.getDefault().getTable(autoChooserPath);result.put("path",autoChooserPath);
    result.set("options",JSON.valueToTree(table.getEntry("options").getStringArray(new String[0])));
    result.put("active",table.getEntry("active").getString(""));result.put("selected",table.getEntry("selected").getString(""));result.put("default",table.getEntry("default").getString(""));return result;
  }
  private static void respondError(com.sun.net.httpserver.HttpExchange e,Exception error)throws IOException {byte[] bytes=JSON.createObjectNode().put("error",error.getMessage()==null?error.toString():error.getMessage()).toString().getBytes(StandardCharsets.UTF_8);e.getResponseHeaders().set("Content-Type","application/json");e.sendResponseHeaders(400,bytes.length);e.getResponseBody().write(bytes);e.close();}
  public static void stop(){failure="Bridge stopped";if(phoenixEnable!=null)phoenixEnable.close();if(physicsClock)SimHooks.resumeTiming();synchronized(TwinBridge.class){if(executor!=null)executor.shutdownNow();if(physics!=null)physics.destroy();if(server!=null)server.stop(0);if(vision!=null)vision.close();if(inputTrace!=null)try{inputTrace.close();}catch(IOException e){e.printStackTrace();}}}
}
