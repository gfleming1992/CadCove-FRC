// Build the original example in a new workspace using the team's installed
// toolchains and official vendor descriptor. No team program or assets are read.
import path from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2),options={};
while(args.length){const k=args.shift(),v=args.shift();if(!['--output','--runtime','--gradle','--phoenix-descriptor','--jdk'].includes(k)||!v||options[k])throw Error('Expected --output NEW_WORKSPACE --runtime DIRECTORY --gradle EXECUTABLE --phoenix-descriptor FILE --jdk DIRECTORY');options[k]=path.resolve(v);}
for(const k of ['--output','--runtime','--gradle','--phoenix-descriptor','--jdk'])if(!options[k])throw Error('Missing '+k);
const root=path.resolve(import.meta.dir,'..'),output=options['--output'];
const descriptor=await readFile(options['--phoenix-descriptor']);
const vendor=JSON.parse(descriptor);
if(vendor.version!=='26.1.3'||String(vendor.frcYear)!=='2026'||vendor.uuid!=='e995de00-2c64-4df5-8831-c1441420ff19')throw Error('This example qualifies the official Phoenix 6 26.1.3 descriptor for WPILib 2026; review other versions separately');
const cli=path.join(options['--runtime'],'cadcove'+(process.platform==='win32'?'.exe':''));
const steps=[];
async function run(name,argv,cwd){
 const start=performance.now();console.log('Training example: '+name);
 const p=Bun.spawn(argv,{cwd,env:{...process.env,JAVA_HOME:options['--jdk'],INSTANTCAD_JDK:options['--jdk']},stdout:'inherit',stderr:'inherit'});
 const code=await p.exited;steps.push({name,exitCode:code,ms:Math.round(performance.now()-start)});if(code)throw Error('Failed: '+name);
}
await run('build original CAD and world',[process.execPath,'scripts/build-training-example.js','--output',output],root);
await run('initialize agent workspace',[cli,'init','--workspace',output,'--id','training-robot','--name','CadCove training robot'],output);
await run('export packaged bridge',[cli,'bridge-export','--workspace',output],output);
await mkdir(path.join(output,'vendordeps'),{recursive:true});await writeFile(path.join(output,'vendordeps/Phoenix6.json'),descriptor);
const configFile=path.join(output,'.cadcove/project.json'),config=JSON.parse(await readFile(configFile,'utf8'));config.simulationProject='training-profile.json';await writeFile(configFile,JSON.stringify(config,null,2)+'\n');
const gradle=process.platform==='win32'&&/\.(bat|cmd)$/i.test(options['--gradle'])
 ?['cmd.exe','/d','/c',options['--gradle']]:[options['--gradle']];
await run('build independent WPILib robot',[...gradle,'--no-daemon','jar','extractReleaseNative'],output);
await run('public CLI robot and season contract',[process.execPath,'tests/training-robot.js','--project',path.join(output,'training-profile.json'),'--runtime',options['--runtime']],root);
const result=JSON.parse(await readFile(path.join(output,'build/cadcove/qualification/result.json'),'utf8'));
const report={schema:1,ok:result.ok,steps,toolboxRuntime:JSON.parse(await readFile(path.join(options['--runtime'],'manifest.json'),'utf8')).version,vendorDescriptorSha256:createHash('sha256').update(descriptor).digest('hex'),vendorVersion:vendor.version,gradleRIO:'2026.2.1',teamRobotOrCADCopied:false,installedEditorTested:false,hardwareQualified:false};
await writeFile(path.join(output,'build/cadcove/qualification/build-report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
