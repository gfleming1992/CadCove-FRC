// Only publish complete, already-tested packages from this exact CI run.
import path from 'node:path';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export const platforms={'macos-14':'darwin-arm64','macos-15-intel':'darwin-x64','windows-2022':'win32-x64','ubuntu-24.04':'linux-x64'};
export function ciVersion(base,run){
 const match=/^(\d+)\.(\d+)\.(\d+)$/.exec(base);
 if(!match||!/^\d+$/.test(String(run))||!Number.isSafeInteger(Number(run))||Number(run)<1||Number(run)<Number(match[3]))throw Error('Invalid Marketplace version or CI run number');
 return `${match[1]}.${match[2]}.${Number(run)}`;
}
async function one(directory,name){
 const found=[];
 async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);else if(entry.isFile()&&entry.name===name)found.push(file);}}
 await walk(directory);if(found.length!==1)throw Error(`Expected one ${name} in ${directory}; found ${found.length}`);return found[0];
}
export function validateEvidence(report,{sha,target,hash,bytes}){
 if(report.ok!==true||report.sourceRevision!==sha||report.target!==target)throw Error('Failed, mismatched or stale platform report: '+target);
 if(!report.steps?.length||report.steps.some(step=>step.exitCode!==0))throw Error('Unsuccessful build steps: '+target);
 if(report.artifacts?.vsix?.sha256!==hash||report.artifacts.vsix.bytes!==bytes)throw Error('VSIX differs from tested artifact: '+target);
 if(target!=='win32-x64'&&(report.editorInstallationTested!==true||report.editorQualification?.qualification?.vsixSha256!==hash))throw Error('Missing exact-package editor test: '+target);
}
export async function verifiedPackages(root,{sha,version,publisher='gfleming1992',name='cadcove-toolbox'}){
 if(!/^[a-f0-9]{40}$/.test(sha)||!/^\d+\.\d+\.\d+$/.test(version))throw Error('Expected exact commit and release version');
 const {readVSIXPackage}=await import('@vscode/vsce/out/zip.js');
 const packages=[];
 for(const [runner,target] of Object.entries(platforms)){
  const file=await one(path.join(root,'toolbox-candidate-'+runner),'cadcove-source-check.vsix');
  const report=JSON.parse(await readFile(await one(path.join(root,'toolbox-reports-'+runner),'source-verification-report.json'),'utf8'));
  const bytes=await readFile(file),hash=createHash('sha256').update(bytes).digest('hex');
  validateEvidence(report,{sha,target,hash,bytes:bytes.length});
  const {manifest,xmlManifest}=await readVSIXPackage(file);
  const identity=xmlManifest.PackageManifest.Metadata[0].Identity[0].$;
  if(manifest.publisher!==publisher||manifest.name!==name||manifest.version!==version||identity.TargetPlatform!==target||identity.Version!==version)throw Error('Wrong Marketplace identity, version or target: '+target);
  packages.push({file,target,version,sha256:hash});
 }
 return packages;
}
if(import.meta.main){
 const [command,...args]=process.argv.slice(2);
 if(command==='version'&&args.length===0){const p=JSON.parse(await readFile(new URL('../extensions/vscode/package.json',import.meta.url)));console.log(ciVersion(p.version,process.env.GITHUB_RUN_NUMBER));}
 else if(command==='verify'&&args.length===1){console.log(JSON.stringify(await verifiedPackages(path.resolve(args[0]),{sha:process.env.GITHUB_SHA,version:process.env.CADCOVE_EXTENSION_VERSION}),null,2));}
 else throw Error('Usage: marketplace-artifacts.js version | verify ARTIFACT_DIRECTORY');
}
