package org.instantcad.frc;
import com.sun.net.httpserver.HttpServer;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.*;
import java.net.http.*;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.*;

public final class ManagedSessionTest {
 public static void main(String[] args)throws Exception{
  Path directory=Files.createTempDirectory("cadcove-session-test-");
  HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
  String token="a".repeat(64),run=UUID.randomUUID().toString(),owner=UUID.randomUUID().toString();
  try{
   ManagedSession session=new ManagedSession(directory.resolve("session.json"),token,owner,"/example/robot.sim.json","another-team",ProcessHandle.current().pid());
   var context=server.createContext("/state",e->{byte[] body="{}".getBytes();e.sendResponseHeaders(200,body.length);e.getResponseBody().write(body);e.close();});
   session.protect(context,run);server.start();session.publish(server.getAddress().getPort(),run,"b".repeat(64));
   var saved=new ObjectMapper().readTree(Files.readString(session.file));
   if(!saved.path("owner").asText().equals(owner)||!saved.path("runId").asText().equals(run))throw new AssertionError("Session identity lost");
   if(saved.path("launcherPid").asLong()!=0)throw new AssertionError("Unregistered launcher watch was advertised as active");
   if(Files.getFileStore(session.file).supportsFileAttributeView("posix")&&!Files.getPosixFilePermissions(session.file).equals(PosixFilePermissions.fromString("rw-------")))throw new AssertionError("Session credentials must be private");
   var client=HttpClient.newHttpClient();URI url=URI.create(saved.path("endpoint").asText()+"/state");
   if(client.send(HttpRequest.newBuilder(url).GET().build(),HttpResponse.BodyHandlers.discarding()).statusCode()!=401)throw new AssertionError("Missing token accepted");
   if(client.send(HttpRequest.newBuilder(url).header("Authorization","Bearer "+"c".repeat(64)).header("X-CadCove-Run",run).GET().build(),HttpResponse.BodyHandlers.discarding()).statusCode()!=401)throw new AssertionError("Other session token accepted");
   if(client.send(HttpRequest.newBuilder(url).header("Authorization","Bearer "+token).header("X-CadCove-Run",UUID.randomUUID().toString()).GET().build(),HttpResponse.BodyHandlers.discarding()).statusCode()!=409)throw new AssertionError("Old run accepted");
   if(client.send(HttpRequest.newBuilder(url).header("Authorization","Bearer "+token).header("X-CadCove-Run",run).GET().build(),HttpResponse.BodyHandlers.discarding()).statusCode()!=200)throw new AssertionError("Current run rejected");
   System.out.println("Managed session: dynamic port, private discovery, token and run isolation verified");
  }finally{server.stop(0);Files.deleteIfExists(directory.resolve("session.json"));Files.delete(directory);}
 }
}
