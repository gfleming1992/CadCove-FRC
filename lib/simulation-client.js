import path from "node:path";
import {readFile,realpath} from "node:fs/promises";
export const sessionFile=project=>path.join(project.build,"cadcove-session.json");

export async function readSession(project){
 const session=JSON.parse(await readFile(sessionFile(project),'utf8'));
 if(!/^[a-f0-9-]{36}$/.test(session.owner)||!Number.isSafeInteger(session.pid)||session.pid<1)throw Error('Invalid simulation process identity');
 const url=new URL(session.endpoint);
 if(session.schema!==1||url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!/^\d+$/.test(url.port)||!/^[a-f0-9]{64}$/.test(session.token)||!/^[a-f0-9-]{36}$/.test(session.runId)||!/^[a-f0-9]{64}$/.test(session.worldHash)||session.projectId!==project.profile.id||await realpath(session.project)!==await realpath(project.profilePath))throw Error('Simulation session does not match this project');
 return session;
}

export async function sessionRequest(project,route,{body,query,timeout=5000}={}){
 if(!['state','objects','devices','controls','shutdown','reset','match','autonomous','motor-controls'].includes(route))throw Error('Unsupported simulation request');
 const session=await readSession(project);
 const url=new URL('/'+route,session.endpoint);
 if(query){for(const [key,value] of Object.entries(query)){if(!['id','prefix','after','limit','near','radius'].includes(key))throw Error('Unknown object query option');for(const item of key==='id'&&Array.isArray(value)?value:[key==='near'&&Array.isArray(value)?value.join(','):value])url.searchParams.append(key,String(item));}}
 if(body?.runId&&body.runId!==session.runId)throw Error('Stale simulation run in command');
 const response=await fetch(url,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+session.token,'X-CadCove-Run':session.runId,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify({...body,runId:session.runId})}),signal:AbortSignal.timeout(timeout),redirect:'error'});
 if(!response.ok)throw Error(`Simulation ${route} request failed (${response.status}); the session may have stopped or restarted.`);
 const result=await response.json();
 if(result.runId&&result.runId!==session.runId||result.worldHash&&result.worldHash!==session.worldHash)throw Error('Simulation response belongs to a different run');
 return result;
}

