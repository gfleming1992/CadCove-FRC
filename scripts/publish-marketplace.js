import path from 'node:path';
import {appendFile} from 'node:fs/promises';
import {verifiedPackages} from './marketplace-artifacts.js';

// Direct Marketplace trusted publishing protocol documented by microsoft/vscode-vsce.
// The pinned vsce 4.0.0 CLI still uses the older token exchange URL/header; keep
// the exchange explicit until a released vsce adopts the documented protocol.
// Tokens stay in this process and expire; no PAT or Microsoft password is stored.
export async function marketplaceCredential(env,request=fetch){
 if(env.GITHUB_ACTIONS!=='true'||!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)throw Error('Publishing requires GitHub Actions OIDC');
 const url=new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
 if(url.protocol!=='https:'||!url.hostname.endsWith('.actions.githubusercontent.com'))throw Error('Unexpected GitHub OIDC endpoint');
 url.searchParams.set('audience','marketplace.visualstudio.com');
 const token=await request(url,{headers:{Authorization:`Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`},signal:AbortSignal.timeout(30000)});
 if(!token.ok)throw Error('GitHub OIDC request failed: '+token.status);
 const {value}=await token.json();if(typeof value!=='string'||!value)throw Error('Missing GitHub OIDC token');
 const response=await request('https://marketplace.visualstudio.com/_apis/gallery/token?api-version=7.2-preview.1',{
  method:'POST',headers:{Authorization:`FederatedToken ${value}`,'Content-Type':'application/json'},body:JSON.stringify({publisherName:'gfleming1992'}),signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('Marketplace trust policy rejected publishing: '+response.status);
 const {credential}=await response.json();if(typeof credential!=='string'||!credential)throw Error('Missing Marketplace credential');
 return credential;
}

async function main(){
 const env=process.env;
 if(env.GITHUB_REPOSITORY!=='gfleming1992/CadCove-FRC'||env.GITHUB_REF!=='refs/heads/main'||!['push','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME))throw Error('Only this repository main branch may publish');
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
