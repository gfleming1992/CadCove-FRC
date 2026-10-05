import path from 'node:path';
import {readFile,realpath} from 'node:fs/promises';
export async function viewerRequest(project,method,args={}){
 if(!['capture','view','state','practice'].includes(method))throw Error('Unsupported viewer request');
 const record=JSON.parse(await readFile(path.join(project.build,'cadcove-viewer.json'),'utf8'));
 const url=new URL(record.endpoint);
 if(record.schema!==1||!/^[a-f0-9]{64}$/.test(record.token)||url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.pathname!=='/'||url.search||url.hash||url.username||url.password||await realpath(record.project)!==await realpath(project.profilePath))throw Error('Viewer does not belong to this project');
 const response=await fetch(new URL('/'+method,url),{method:'POST',headers:{Authorization:'Bearer '+record.token,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(20000),redirect:'error'});
 const result=await response.json();if(!response.ok||!result.ok)throw Error(result.error||'Viewer request failed');return result;
}
