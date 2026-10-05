import {createHash} from 'node:crypto';

export const exampleSourceFiles = [
 'README.md','build.gradle','settings.gradle',
 'cad/model.js','cad/design.js','cad/components.js',
 'src/main/java/frc/robot/Main.java','src/main/java/frc/robot/Robot.java',
 'src/main/java/frc/simulation/TrainingZoneSeason.java',
 'src/main/resources/META-INF/services/org.instantcad.frc.SeasonPlugin',
 'vendor/limelight/upstream.json','vendor/limelight/LimelightHelpers.java','vendor/limelight/LICENSE',
];
export const exampleRequiredFiles = [...exampleSourceFiles,'training-profile.json','build/cadcove/world.json','build/cadcove/scene-bindings.json',
 ...['robot','field'].flatMap(kind=>['assembly.json','catalog.json','instances.json'].map(file=>`build/cadcove/${kind}/${file}`))];
export const exampleDigest = bytes => createHash('sha256').update(bytes).digest('hex');
export const allowedExamplePath = file => exampleRequiredFiles.includes(file)||/^build\/cadcove\/(robot|field)\/meshes\/[a-z0-9][a-z0-9-]{0,99}\.bin$/.test(file);

// This bundle is shipped with the verified runtime, not downloaded from a
// workspace URL. Still validate its complete contents before creating files.
export function decodeExampleBundle(bundle){
 if(bundle?.schema!==1||bundle.id!=='training-robot'||!Array.isArray(bundle.files)||bundle.files.length>128)throw Error('Invalid training example bundle');
 const files=new Map();let total=0;
 for(const entry of bundle.files){
  if(typeof entry.path!=='string'||!allowedExamplePath(entry.path)||files.has(entry.path)||typeof entry.data!=='string'||entry.data.length>2*1024*1024||!Number.isSafeInteger(entry.bytes)||entry.bytes<1||!/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('Invalid example bundle entry');
  const bytes=Buffer.from(entry.data,'base64');
  if(bytes.toString('base64')!==entry.data||bytes.length!==entry.bytes||exampleDigest(bytes)!==entry.sha256)throw Error('Example bundle checksum mismatch: '+entry.path);
  total+=bytes.length;if(total>4*1024*1024)throw Error('Example bundle exceeds size limit');
  files.set(entry.path,bytes);
 }
 for(const file of exampleRequiredFiles)if(!files.has(file))throw Error('Example bundle missing '+file);
 const helper=JSON.parse(files.get('vendor/limelight/upstream.json'));
 for(const file of ['LimelightHelpers.java','LICENSE'])if(helper.files?.[file]!==exampleDigest(files.get('vendor/limelight/'+file)))throw Error('Example Limelight source pin mismatch');
 return files;
}
