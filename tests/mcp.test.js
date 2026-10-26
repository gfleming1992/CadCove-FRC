import {test,expect} from 'bun:test';
import {startMcpServer,z} from '../lib/mcp-server.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

test('real MCP discovery/call, validation, trust revocation and local authentication',async()=>{
 let trusted=true,calls=0;
 const server=await startMcpServer({allowed:()=>trusted,tools:[{name:'open_robot_cad',description:'Open robot',schema:{workspace:z.string().optional()},run:()=>{calls++;return {ok:true,instances:42};}},{name:'pending',description:'Background preparation',run:()=>({ok:false,pending:true,blocked:[{jobId:'job1'}]})},{name:'broken',description:'Failure feedback',run:()=>{throw Error('Missing CAD');}}]});
 const client=new Client({name:'test-agent',version:'1'});
 try{
  expect((await fetch(server.url,{method:'POST'})).status).toBe(401);
  expect((await fetch(server.url,{method:'POST',headers:{Authorization:'Bearer '+server.token,Origin:'https://evil.example'}})).status).toBe(403);
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url),{requestInit:{headers:{Authorization:'Bearer '+server.token}}}));
  expect((await client.listTools()).tools.map(t=>t.name)).toEqual(['open_robot_cad','pending','broken']);
  const opened=await client.callTool({name:'open_robot_cad',arguments:{}});expect(JSON.parse(opened.content[0].text).instances).toBe(42);expect(calls).toBe(1);
  expect((await client.callTool({name:'open_robot_cad',arguments:{workspace:1}})).isError).toBe(true);expect(calls).toBe(1);
  expect((await client.callTool({name:'broken',arguments:{}})).content[0].text).toBe('Missing CAD');
  const pending=await client.callTool({name:'pending',arguments:{}});expect(pending.isError).not.toBe(true);expect(JSON.parse(pending.content[0].text).blocked[0].jobId).toBe('job1');
  trusted=false;await expect(client.listTools()).rejects.toThrow();
 }finally{await client.close();await server.close();}
});

test('cad-open CLI uses the running editor without chat tool registration and reports failures',async()=>{
 const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const path=await import('node:path');
 const root=await mkdtemp(path.join(tmpdir(),'cadcove-open-'));let fail=false,calls=0;
 const server=await startMcpServer({tools:[{name:'open_robot_cad',description:'Open robot',schema:{workspace:z.string()},run:args=>{expect(args.workspace).toBe(root);calls++;if(fail)throw Error('CAD entry is missing');return {ok:true,kind:'cadquery'};}}]});
 try{
  await mkdir(path.join(root,'.cadcove'));await mkdir(path.join(root,'build'));
  await writeFile(path.join(root,'.cadcove/project.json'),JSON.stringify({buildDirectory:'build'}));
  await writeFile(path.join(root,'build/cadcove-mcp.json'),JSON.stringify({schema:1,workspace:root,endpoint:server.url,token:server.token}));
  const cli=path.resolve(import.meta.dir,'../bin/cadcove.js');
  const run=async()=>{const p=Bun.spawn([process.execPath,cli,'cad-open','--workspace',root],{stdout:'pipe',stderr:'pipe'});const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);expect(err).toBe('');return {code,result:JSON.parse(out)};};
  const opened=await run();expect(opened.code).toBe(0);expect(opened.result).toMatchObject({ok:true,command:'cad-open',workspace:root,kind:'cadquery'});
  fail=true;const failed=await run();expect(failed.code).toBe(2);expect(failed.result.ok).toBe(false);expect(failed.result.error.message).toBe('CAD entry is missing');expect(calls).toBe(2);
 }finally{await server.close();await rm(root,{recursive:true,force:true});}
});

test('highlight CLI preserves multiple exact part IDs and colors and can clear them',async()=>{
 const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const path=await import('node:path');
 const root=await mkdtemp(path.join(tmpdir(),'cadcove-highlight-'));let parts=[];
 const server=await startMcpServer({tools:[{name:'cad_highlight',description:'Highlight CAD parts',schema:{workspace:z.string(),action:z.enum(['set','clear','state']),parts:z.array(z.object({id:z.string(),color:z.string().optional()})).optional()},run:a=>{expect(a.workspace).toBe(root);if(a.action==='set')parts=a.parts;if(a.action==='clear')parts=[];return {ok:true,highlights:parts};}}]});
 try{
  await mkdir(path.join(root,'.cadcove'));await mkdir(path.join(root,'build'));
  await writeFile(path.join(root,'.cadcove/project.json'),JSON.stringify({buildDirectory:'build'}));
  await writeFile(path.join(root,'build/cadcove-mcp.json'),JSON.stringify({schema:1,workspace:root,endpoint:server.url,token:server.token}));
  const expected=[{id:'motor/left'},{id:'pulley/right',color:'#e95dca'}],input=path.join(root,'highlights.json');await writeFile(input,JSON.stringify({parts:expected}));
  const run=async(command,args=[])=>{const p=Bun.spawn([process.execPath,path.resolve(import.meta.dir,'../bin/cadcove.js'),command,'--workspace',root,...args],{stdout:'pipe',stderr:'pipe'});const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);expect(err).toBe('');expect(code).toBe(0);return JSON.parse(out);};
  expect((await run('cad-highlight',['--input',input])).highlights).toEqual(expected);
  expect((await run('cad-highlight-state')).highlights).toEqual(expected);
  expect((await run('cad-clear-highlights')).highlights).toEqual([]);
 }finally{await server.close();await rm(root,{recursive:true,force:true});}
});
