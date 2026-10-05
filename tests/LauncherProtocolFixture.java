package org.instantcad.frc;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.UUID;

/** Launcher protocol stand-in only: no HAL, Phoenix, physics or robot code. */
public final class LauncherProtocolFixture {
  public static void main(String[] args)throws Exception{
    ManagedSession owned=ManagedSession.fromEnvironment();
    boolean legacy="legacy".equals(System.getenv("CADCOVE_OWNER_FIXTURE_MODE"));
    ManagedSession session=legacy?new ManagedSession(owned.file,owned.token,owned.owner,owned.project,owned.projectId):owned;
    if(!legacy)session.watchLauncher(()->System.exit(0));
    String run=UUID.randomUUID().toString();
    String world=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(Path.of(System.getenv("INSTANTCAD_WORLD")))));
    HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
    for(String route:new String[]{"/state","/shutdown"}){
      var context=server.createContext(route,e->{
        byte[] body=("{\"runId\":\""+run+"\",\"worldHash\":\""+world+"\",\"error\":\"\"}").getBytes(StandardCharsets.UTF_8);
        e.sendResponseHeaders(200,body.length);e.getResponseBody().write(body);e.close();
        if(route.equals("/shutdown"))new Thread(()->System.exit(0)).start();
      });session.protect(context,run);
    }
    Runtime.getRuntime().addShutdownHook(new Thread(()->server.stop(0)));
    server.start();session.publish(server.getAddress().getPort(),run,world);
  }
}
