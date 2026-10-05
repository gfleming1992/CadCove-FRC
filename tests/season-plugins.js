// Portable integration harness: supply Jackson/WPILib dependency classpath and
// an already-built native engine. No developer paths or team fixture required.
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,readFile,rm} from 'node:fs/promises';
import {javaExecutable} from '../lib/java-runtime.js';
const args=process.argv.slice(2),options={};while(args.length){const name=args.shift(),value=args.shift();if(!['--classpath','--native-binary','--jdk'].includes(name)||!value||options[name])throw Error('Expected --classpath JARS --native-binary FILE [--jdk JDK_DIRECTORY]');options[name]=value;}
if(!options['--classpath']||!options['--native-binary'])throw Error('--classpath and --native-binary are required');
const root=path.resolve(import.meta.dir,'..'),directory=await mkdtemp(path.join(os.tmpdir(),'cadcove-season-tests-'));
const java=await javaExecutable({root,profile:{runtime:{...(options['--jdk']?{jdk:options['--jdk']}:{})}}}),javac=path.join(path.dirname(java),process.platform==='win32'?'javac.exe':'javac');
async function run(command){const child=Bun.spawn(command,{cwd:root,stdout:'pipe',stderr:'pipe'}),timer=setTimeout(()=>child.kill(),60000);try{const [out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);if(code)throw Error(`Command failed (${code}): ${out}\n${err}`);return out.trim();}finally{clearTimeout(timer);}}
try{
 const sources=['SeasonPlugin','SeasonObserver','SeasonFrame','MatchRuntime','RebuiltMatch','RebuiltSeason'].map(name=>path.join(root,'bridge/java/org/instantcad/frc',name+'.java'));
 sources.push(path.join(root,'examples/season-plugin/src/main/java/frc/simulation/TrainingZoneSeason.java'),...['SeasonPluginTest','SeasonCompatibilityTest','RebuiltMatchTest'].map(name=>path.join(root,'tests',name+'.java')));
 await run([javac,'-cp',options['--classpath'],'-d',directory,...sources]);
 const services=path.join(directory,'META-INF/services');await mkdir(services,{recursive:true});await copyFile(path.join(root,'examples/season-plugin/src/main/resources/META-INF/services/org.instantcad.frc.SeasonPlugin'),path.join(services,'org.instantcad.frc.SeasonPlugin'));
 const classpath=directory+path.delimiter+options['--classpath'];
 const external=await run([java,'-cp',classpath,'org.instantcad.frc.SeasonPluginTest',path.resolve(options['--native-binary'])]);
 const regression=await run([java,'-cp',classpath,'org.instantcad.frc.RebuiltMatchTest']);
 const compatibility=await run([java,'-cp',classpath,'org.instantcad.frc.SeasonCompatibilityTest']);
 assert.deepEqual(JSON.parse(compatibility),JSON.parse(await readFile(path.join(root,'tests/fixtures/season-compatibility.json'),'utf8')),'Existing 2026 scoring/timing behavior changed');
 console.log(JSON.stringify({ok:true,externalProvider:true,realNativeEngine:true,legacyGoldenMatch:true,external,regression}));
}finally{await rm(directory,{recursive:true,force:true});}
