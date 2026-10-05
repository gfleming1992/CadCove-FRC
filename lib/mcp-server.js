import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {z} from 'zod';

// Keep the protocol independent of VS Code. The editor supplies bounded actions;
// there is deliberately no arbitrary shell command or unrestricted path tool.
export async function startMcpServer({tools,allowed=()=>true,instructions='Use open_robot_cad immediately for requests to open/show the robot. It does not start physics. Use workspace_context for configuration, then focused tools for CAD and simulation. Edit source through your normal editor tools.'}) {
 const token=randomBytes(32).toString('hex'),active=new Set();let closed=false;
 const server=createServer(async(req,res)=>{
  const reject=(code,message)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:message}));};
  if(closed||!allowed()||req.headers.authorization!=='Bearer '+token)return reject(401,'CadCove access denied');
  // No browser-origin access: these tools control a trusted local editor.
  if(req.headers.origin)return reject(403,'Browser origins are not allowed');
  if(req.headers.host!==`127.0.0.1:${server.address().port}`||req.url!=='/mcp')return reject(404,'Unknown endpoint');
  if(req.method!=='POST')return reject(405,'Use MCP POST');
  if(active.size>=8)return reject(429,'Too many concurrent requests');
  const mcp=new McpServer({name:'CadCove',version:'0.1.1'},{instructions});
  for(const tool of tools)mcp.registerTool(tool.name,{description:tool.description,inputSchema:tool.schema??{},annotations:{readOnlyHint:!!tool.readOnly,destructiveHint:false,openWorldHint:false}},async args=>{
   try{
    if(!allowed())throw Error('Workspace trust is required');
    const result=await tool.run(args);
    if(result?.content)return result;
    return {content:[{type:'text',text:JSON.stringify(result??{ok:true})}],...(result?.ok===false?{isError:true}:{})};
   }catch(error){return {isError:true,content:[{type:'text',text:error.message}]};}
  });
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});active.add(mcp);
  res.on('close',()=>{active.delete(mcp);void mcp.close();});
  try{
   let length=0,chunks=[];
   for await(const chunk of req){length+=chunk.length;if(length>65536){reject(413,'MCP request exceeds 64 KiB');return;}chunks.push(chunk);}
   const body=JSON.parse(Buffer.concat(chunks).toString());
   await mcp.connect(transport);await transport.handleRequest(req,res,body);
  }catch(error){if(!res.headersSent)reject(400,'Invalid MCP request');else res.end();}
 });
 server.requestTimeout=30000;server.headersTimeout=5000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return {url:`http://127.0.0.1:${server.address().port}/mcp`,token,async close(){closed=true;server.close();server.closeAllConnections();await Promise.allSettled([...active].map(s=>s.close()));}};
}
export {z};
