package org.instantcad.frc;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.Filter;
import com.sun.net.httpserver.HttpContext;
import com.sun.net.httpserver.HttpExchange;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.MessageDigest;
import java.util.Map;

/** Optional authenticated local endpoint for an owned toolbox session. */
final class ManagedSession {
  private static final ObjectMapper JSON=new ObjectMapper();
  final Path file;
  final String token,owner,project,projectId;
  final long launcherPid;
  private boolean watchingLauncher;
  ManagedSession(Path file,String token,String owner,String project,String projectId){
    this(file,token,owner,project,projectId,0);
  }
  ManagedSession(Path file,String token,String owner,String project,String projectId,long launcherPid){
    if(!token.matches("[a-f0-9]{64}")||!owner.matches("[a-f0-9-]{36}")||project.isBlank()||projectId.isBlank())throw new IllegalArgumentException("Invalid managed session identity");
    if(launcherPid<0)throw new IllegalArgumentException("Invalid launcher PID");
    this.file=file.toAbsolutePath().normalize();this.token=token;this.owner=owner;this.project=project;this.projectId=projectId;
    this.launcherPid=launcherPid;
  }
  static ManagedSession fromEnvironment(){
    Map<String,String> env=System.getenv();String file=env.get("CADCOVE_SESSION_FILE");
    if(file==null)return null;
    return new ManagedSession(Path.of(file),env.getOrDefault("CADCOVE_SESSION_TOKEN",""),env.getOrDefault("CADCOVE_SESSION_OWNER",""),env.getOrDefault("INSTANTCAD_PROJECT",""),env.getOrDefault("CADCOVE_PROJECT_ID",""),Long.parseLong(env.getOrDefault("CADCOVE_LAUNCHER_PID","0")));
  }
  void watchLauncher(Runnable onExit){
    // Unmanaged/legacy embedding remains possible, but the current CLI requires
    // its own PID in discovery before accepting this bridge as ready.
    if(launcherPid==0)return;
    ProcessHandle parent=ProcessHandle.current().parent().orElse(null);
    if(parent==null||parent.pid()!=launcherPid||!parent.isAlive()){
      onExit.run();
      throw new IllegalStateException("Managed simulation launcher is no longer the live parent");
    }
    // Capture the actual parent handle once. Never poll a numeric PID that
    // could later belong to a different process after launcher termination.
    parent.onExit().thenRun(onExit);
    watchingLauncher=true;
  }
  void protect(HttpContext context,String runId){
    context.getFilters().add(new Filter(){
      public String description(){return "Owned local simulation session";}
      public void doFilter(HttpExchange exchange,Chain chain)throws IOException{
        String auth=exchange.getRequestHeaders().getFirst("Authorization");
        if(auth==null||!MessageDigest.isEqual(("Bearer "+token).getBytes(StandardCharsets.UTF_8),auth.getBytes(StandardCharsets.UTF_8))){exchange.sendResponseHeaders(401,-1);exchange.close();return;}
        if(!runId.equals(exchange.getRequestHeaders().getFirst("X-CadCove-Run"))){exchange.sendResponseHeaders(409,-1);exchange.close();return;}
        chain.doFilter(exchange);
      }
    });
  }
  void publish(int port,String runId,String worldHash)throws IOException{
    var value=JSON.createObjectNode().put("schema",1).put("owner",owner).put("project",project).put("projectId",projectId)
      .put("endpoint","http://127.0.0.1:"+port).put("token",token).put("runId",runId).put("worldHash",worldHash).put("pid",ProcessHandle.current().pid()).put("launcherPid",watchingLauncher?launcherPid:0);
    Files.createDirectories(file.getParent());
    Path temporary=Files.createTempFile(file.getParent(),".session-",".tmp");
    try{
      if(Files.getFileStore(temporary).supportsFileAttributeView("posix"))Files.setPosixFilePermissions(temporary,PosixFilePermissions.fromString("rw-------"));
      Files.writeString(temporary,value.toString(),StandardCharsets.UTF_8);
      try{Files.move(temporary,file,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);}
      catch(AtomicMoveNotSupportedException ex){Files.move(temporary,file,StandardCopyOption.REPLACE_EXISTING);}
    }finally{Files.deleteIfExists(temporary);}
  }
}
