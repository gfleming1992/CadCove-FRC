import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {relativePath} from '../vendor/cad-core/extensions/vscode/src/project-files.js';

// Other local agent hosts use the same editor tools via stdio. The secret stays
// in the generated cache; it is not copied into committed agent configuration.
export async function runMcpProxy(workspace){
 const root=path.resolve(workspace),config=JSON.parse(await readFile(path.join(root,'.cadcove/project.json'),'utf8'));relativePath(config.buildDirectory);
 let record;
 try{record=JSON.parse(await readFile(path.join(root,config.buildDirectory,'cadcove-mcp.json'),'utf8'));}catch{throw Error('Open this workspace in VS Code with CadCove enabled first; its MCP server starts automatically.');}
 const url=new URL(record.endpoint);
 if(record.schema!==1||path.resolve(record.workspace)!==root||url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.pathname!=='/mcp'||url.search||url.hash||url.username||url.password||!/^[a-f0-9]{64}$/.test(record.token))throw Error('Invalid local MCP descriptor');
 const client=new Client({name:'cadcove-editor-bridge',version:'0.1.1'});
 await client.connect(new StreamableHTTPClientTransport(url,{requestInit:{headers:{Authorization:'Bearer '+record.token},redirect:'error'}}));
 const server=new Server({name:'CadCove',version:'0.1.1'},{capabilities:{tools:{}},instructions:'Use open_robot_cad immediately to open/show the robot. Use workspace_context for configuration; source edits remain normal editor operations.'});
 server.setRequestHandler(ListToolsRequestSchema,()=>client.listTools());
 server.setRequestHandler(CallToolRequestSchema,r=>client.callTool({...r.params,arguments:{...r.params.arguments,workspace:root}},undefined,{timeout:120000}));
 let closing=false;const close=async()=>{if(closing)return;closing=true;await Promise.allSettled([client.close(),server.close()]);};
 server.onclose=close;process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close());
 await server.connect(new StdioServerTransport());
}
