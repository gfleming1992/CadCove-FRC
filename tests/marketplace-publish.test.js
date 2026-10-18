import {test,expect} from 'bun:test';
import {readFile} from 'node:fs/promises';
import {ciVersion,validateEvidence} from '../scripts/marketplace-artifacts.js';
import {marketplaceCredential} from '../scripts/publish-marketplace.js';

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

test('trusted publishing uses only the scoped GitHub token and documented Marketplace exchange',async()=>{
 const env={GITHUB_ACTIONS:'true',ACTIONS_ID_TOKEN_REQUEST_TOKEN:'request-secret',ACTIONS_ID_TOKEN_REQUEST_URL:'https://pipelines.actions.githubusercontent.com/token?api-version=2'};
 const calls=[];
 const request=async(url,options)=>{calls.push({url:String(url),...options});return new Response(JSON.stringify(calls.length===1?{value:'oidc-token'}:{credential:'session-token'}));};
 expect(await marketplaceCredential(env,request)).toBe('session-token');
 expect(new URL(calls[0].url).searchParams.get('audience')).toBe('marketplace.visualstudio.com');
 expect(calls[1].url).toBe('https://marketplace.visualstudio.com/_apis/gallery/token?api-version=7.2-preview.1');
 expect(calls[1].headers.Authorization).toBe('FederatedToken oidc-token');
 expect(JSON.parse(calls[1].body)).toEqual({publisherName:'gfleming1992'});
 await expect(marketplaceCredential({...env,ACTIONS_ID_TOKEN_REQUEST_URL:'https://example.com/token'},request)).rejects.toThrow('Unexpected');
 await expect(marketplaceCredential(env,async()=>new Response('denied',{status:403}))).rejects.toThrow('403');
});

test('publication is downstream of the whole matrix, gated to main and disabled until connected',async()=>{
 const workflow=Bun.YAML.parse(await readFile(new URL('../.github/workflows/toolbox-source.yml',import.meta.url),'utf8'));
 const job=workflow.jobs.marketplace;
 expect(job.needs).toEqual(['version','source-build']);
 expect(job.if).toContain("github.ref == 'refs/heads/main'");
 expect(job.if).toContain("vars.MARKETPLACE_PUBLISH_ENABLED == 'true'");
 expect(job.permissions['id-token']).toBe('write');
 expect(workflow.permissions).toEqual({contents:'read'});
 expect(workflow.jobs['source-build'].env.CADCOVE_EXTENSION_VERSION).toBe('${{ needs.version.outputs.extension }}');
});
