import {test,expect} from 'bun:test';
import {readFile} from 'node:fs/promises';
import {ciVersion,validateEvidence} from '../scripts/marketplace-artifacts.js';
import {marketplaceCredential,publisherIdentity} from '../scripts/publish-marketplace.js';

test('CI versions are unique per run, stable on retry and reject invalid inputs',()=>{
 expect(ciVersion('0.2.1','23')).toBe('0.2.23');expect(ciVersion('0.2.1','24')).toBe('0.2.24');
 expect(ciVersion('0.3.0','24')).toBe('0.3.24');
 for(const run of ['0','-1','1.2','abc','9007199254740992'])expect(()=>ciVersion('0.2.1',run)).toThrow();
 expect(()=>ciVersion('0.2.100','23')).toThrow();
});

test('publishing rejects failed, stale and modified packages and missing editor evidence',()=>{
 const info={sha:'a'.repeat(40),target:'darwin-arm64',hash:'b'.repeat(64),bytes:123};
 const report={ok:true,sourceRevision:info.sha,target:info.target,steps:[{exitCode:0}],artifacts:{vsix:{sha256:info.hash,bytes:123}},editorInstallationTested:true,editorQualification:{qualification:{vsixSha256:info.hash}}};
 expect(()=>validateEvidence(report,info)).not.toThrow();
 for(const patch of [{ok:false},{sourceRevision:'c'.repeat(40)},{target:'win32-x64'},{steps:[{exitCode:1}]},{editorInstallationTested:false},{artifacts:{vsix:{sha256:info.hash,bytes:124}}},{editorQualification:{qualification:{vsixSha256:'wrong'}}}])expect(()=>validateEvidence({...report,...patch},info)).toThrow();
 expect(()=>validateEvidence({...report,target:'win32-x64',editorInstallationTested:false},{...info,target:'win32-x64'})).not.toThrow();
});

test('publishing exchanges GitHub identity only for the Entra Marketplace resource',async()=>{
 const env={GITHUB_ACTIONS:'true',AZURE_TENANT_ID:'11111111-1111-1111-1111-111111111111',AZURE_CLIENT_ID:'22222222-2222-2222-2222-222222222222',ACTIONS_ID_TOKEN_REQUEST_TOKEN:'request-secret',ACTIONS_ID_TOKEN_REQUEST_URL:'https://pipelines.actions.githubusercontent.com/token?api-version=2'};
 const calls=[];
 const request=async(url,options)=>{calls.push({url:String(url),...options});return new Response(JSON.stringify(calls.length===1?{value:'oidc-token'}:{access_token:'session-token',token_type:'Bearer'}));};
 expect(await marketplaceCredential(env,request)).toBe('session-token');
 expect(new URL(calls[0].url).searchParams.get('audience')).toBe('api://AzureADTokenExchange');
 expect(calls[1].url).toBe('https://login.microsoftonline.com/'+env.AZURE_TENANT_ID+'/oauth2/v2.0/token');
 expect(Object.fromEntries(calls[1].body)).toEqual({client_id:env.AZURE_CLIENT_ID,scope:'499b84ac-1321-427f-aa17-267ca6975798/.default',grant_type:'client_credentials',client_assertion_type:'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',client_assertion:'oidc-token'});
 await expect(marketplaceCredential({...env,AZURE_TENANT_ID:'bad'},request)).rejects.toThrow('Configure Azure');
 await expect(marketplaceCredential({...env,ACTIONS_ID_TOKEN_REQUEST_URL:'https://example.com/token'},request)).rejects.toThrow('Unexpected');
 await expect(marketplaceCredential(env,async()=>new Response('denied',{status:403}))).rejects.toThrow('403');
});

test('identity setup only returns the publisher member ID and display name',async()=>{
 const id='33333333-3333-3333-3333-333333333333';
 const profile=await publisherIdentity('short-lived',async(url,options)=>{
  expect(url).toBe('https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1');
  expect(options.headers.Authorization).toBe('Bearer short-lived');
  return new Response(JSON.stringify({id,displayName:'CadCove publisher',otherPrivateData:'not printed'}));
 });
 expect(profile).toEqual({id,displayName:'CadCove publisher'});
 await expect(publisherIdentity('token',async()=>new Response('denied',{status:403}))).rejects.toThrow('403');
});

test('publication is downstream of the whole matrix, gated to main and disabled until connected',async()=>{
 const workflow=Bun.YAML.parse(await readFile(new URL('../.github/workflows/toolbox-source.yml',import.meta.url),'utf8'));
 const job=workflow.jobs.marketplace;
 expect(job.needs).toEqual(['version','source-build']);
 expect(job.if).toContain("github.ref == 'refs/heads/main'");
 expect(job.if).toContain("vars.MARKETPLACE_PUBLISH_ENABLED == 'true'");
 expect(job.permissions['id-token']).toBe('write');
 expect(job.env.AZURE_CLIENT_ID).toBe('${{ vars.AZURE_CLIENT_ID }}');
 const identity=Bun.YAML.parse(await readFile(new URL('../.github/workflows/marketplace-identity.yml',import.meta.url),'utf8'));
 expect(Object.keys(identity.on)).toEqual(['workflow_dispatch']);
 expect(identity.jobs.identity.if).toContain("github.ref == 'refs/heads/main'");
 expect(workflow.permissions).toEqual({contents:'read'});
 expect(workflow.jobs['source-build'].env.CADCOVE_EXTENSION_VERSION).toBe('${{ needs.version.outputs.extension }}');
});
