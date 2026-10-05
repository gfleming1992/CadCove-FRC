import {test,expect} from 'bun:test';
import {startMcpServer,z} from '../lib/mcp-server.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

test('real MCP discovery/call, validation, trust revocation and local authentication',async()=>{
 let trusted=true,calls=0;
 const server=await startMcpServer({allowed:()=>trusted,tools:[{name:'open_robot_cad',description:'Open robot',schema:{workspace:z.string().optional()},run:()=>{calls++;return {ok:true,instances:42};}},{name:'broken',description:'Failure feedback',run:()=>{throw Error('Missing CAD');}}]});
 const client=new Client({name:'test-agent',version:'1'});
 try{
  expect((await fetch(server.url,{method:'POST'})).status).toBe(401);
  expect((await fetch(server.url,{method:'POST',headers:{Authorization:'Bearer '+server.token,Origin:'https://evil.example'}})).status).toBe(403);
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url),{requestInit:{headers:{Authorization:'Bearer '+server.token}}}));
  expect((await client.listTools()).tools.map(t=>t.name)).toEqual(['open_robot_cad','broken']);
  const opened=await client.callTool({name:'open_robot_cad',arguments:{}});expect(JSON.parse(opened.content[0].text).instances).toBe(42);expect(calls).toBe(1);
  expect((await client.callTool({name:'open_robot_cad',arguments:{workspace:1}})).isError).toBe(true);expect(calls).toBe(1);
  expect((await client.callTool({name:'broken',arguments:{}})).content[0].text).toBe('Missing CAD');
  trusted=false;await expect(client.listTools()).rejects.toThrow();
 }finally{await client.close();await server.close();}
});
