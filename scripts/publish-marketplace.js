import path from 'node:path';
import {appendFile} from 'node:fs/promises';
import {verifiedPackages} from './marketplace-artifacts.js';

// GitHub -> Microsoft Entra workload federation -> Azure DevOps/Marketplace.
// Only short-lived tokens are used; no PAT, client secret or password is stored.
export async function marketplaceCredential(env,request=fetch){
 if(env.GITHUB_ACTIONS!=='true'||!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)throw Error('Publishing requires GitHub Actions OIDC');
 const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
 if(!uuid.test(env.AZURE_TENANT_ID??'')||!uuid.test(env.AZURE_CLIENT_ID??''))throw Error('Configure Azure tenant and publishing application IDs');
 const url=new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
 if(url.protocol!=='https:'||!url.hostname.endsWith('.actions.githubusercontent.com'))throw Error('Unexpected GitHub OIDC endpoint');
 url.searchParams.set('audience','api://AzureADTokenExchange');
 const token=await request(url,{headers:{Authorization:`Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`},signal:AbortSignal.timeout(30000)});
 if(!token.ok)throw Error('GitHub OIDC request failed: '+token.status);
 const {value}=await token.json();if(typeof value!=='string'||!value)throw Error('Missing GitHub OIDC token');
 const response=await request(`https://login.microsoftonline.com/${env.AZURE_TENANT_ID}/oauth2/v2.0/token`,{
  method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.AZURE_CLIENT_ID,scope:'499b84ac-1321-427f-aa17-267ca6975798/.default',grant_type:'client_credentials',client_assertion_type:'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',client_assertion:value}),signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('Microsoft Entra token exchange failed: '+response.status);
 const {access_token,token_type}=await response.json();if(typeof access_token!=='string'||!access_token||token_type?.toLowerCase()!=='bearer')throw Error('Missing Microsoft Entra credential');
 return access_token;
}

export async function publisherIdentity(credential,request=fetch){
 const response=await request('https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1',{headers:{Authorization:`Bearer ${credential}`},signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('Marketplace identity lookup failed: '+response.status);
 const profile=await response.json();
 if(!/^[a-f0-9-]{36}$/i.test(profile.id??''))throw Error('Missing Marketplace identity ID');
 return {id:profile.id,displayName:profile.displayName};
}

async function main(){
 const env=process.env;
 if(env.GITHUB_REPOSITORY!=='gfleming1992/CadCove-FRC'||env.GITHUB_REF!=='refs/heads/main'||!['push','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME))throw Error('Only this repository main branch may publish');
 if(process.argv[2]==='identity'&&process.argv.length===3){
  if(env.GITHUB_EVENT_NAME!=='workflow_dispatch')throw Error('Identity setup must be dispatched manually');
  const credential=await marketplaceCredential(env);
  console.log('::add-mask::'+credential.replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A'));
  console.log(JSON.stringify(await publisherIdentity(credential)));
  return;
 }
 if(process.argv.length!==3)throw Error('Usage: publish-marketplace.js ARTIFACT_DIRECTORY');
 const packages=await verifiedPackages(path.resolve(process.argv[2]),{sha:env.GITHUB_SHA,version:env.CADCOVE_EXTENSION_VERSION});
 // A queued run must not publish an old source revision after a newer push.
 const response=await fetch('https://api.github.com/repos/gfleming1992/CadCove-FRC/git/ref/heads/main',{headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${env.GH_TOKEN}`},signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('Cannot verify current main revision: '+response.status);
 const tip=await response.json();
 if(tip.object?.sha!==env.GITHUB_SHA){console.log('Superseded by a newer main push; publication skipped.');return;}
 const credential=await marketplaceCredential(env);
 // GitHub masks the ephemeral credential before invoking the publisher.
 console.log('::add-mask::'+credential.replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A'));
 const {publishVSIX}=await import('@vscode/vsce');
 await publishVSIX(packages.map(p=>p.file),{pat:credential,skipDuplicate:true});
 if(env.GITHUB_STEP_SUMMARY)await appendFile(env.GITHUB_STEP_SUMMARY,`Published **${env.CADCOVE_EXTENSION_VERSION}** for ${packages.map(p=>p.target).join(', ')} from \`${env.GITHUB_SHA}\`.\n\n[Marketplace listing](https://marketplace.visualstudio.com/items?itemName=gfleming1992.cadcove-toolbox)\n`);
}
if(import.meta.main)await main();
