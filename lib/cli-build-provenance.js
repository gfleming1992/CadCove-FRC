import {createHash} from 'node:crypto';
export const bunRelease=Object.freeze({version:'1.4.2',revision:'744846f844374847c902b5e7fd59b4342a51ef99'});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const identity=bytes=>({bytes:bytes.length,sha256:digest(bytes)});
const platforms=['darwin-arm64','darwin-x64','linux-x64','linux-arm64','win32-x64','win32-arm64'];

export function cliCompilerRecord(binary,{version,revision,target}){
 if(version!==bunRelease.version||revision!==bunRelease.revision)throw Error('CLI release requires the reviewed Bun version and revision');
 if(!platforms.includes(target)||!binary.length)throw Error('Invalid CLI compiler target/binary');
 return {version,revision,target,binary:identity(binary)};
}
export function cliBuildRecord(binary,lock,{compiler,target,version}){
 if(!platforms.includes(target)||compiler?.target!==target||compiler.version!==bunRelease.version||compiler.revision!==bunRelease.revision)throw Error('Unreviewed or mismatched CLI compiler');
 if(!Number.isSafeInteger(compiler.binary?.bytes)||compiler.binary.bytes<1||!/^[a-f0-9]{64}$/.test(compiler.binary.sha256))throw Error('Invalid CLI compiler binary identity');
 if(!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)||!binary.length)throw Error('Invalid CLI version/binary');
 return {schema:1,target,version,compiler:{...bunRelease,target,binary:{bytes:compiler.binary.bytes,sha256:compiler.binary.sha256}},binary:identity(binary),bunLockSha256:digest(lock),compile:{minify:true,bundled:true}};
}
// Packaging consistency, not a signature or attestation of a trusted host.
// The compiler hash identifies the observed executable; it does not itself
// establish source-build qualification. That evidence is recorded separately.
export function validateCliBuild(record,binary,lock,{target,version}){
 if(record?.schema!==1||record.target!==target||record.version!==version)throw Error('CLI build target/version mismatch');
 const expected=cliBuildRecord(binary,lock,{compiler:record.compiler,target,version});
 if(record.binary?.bytes!==expected.binary.bytes||record.binary?.sha256!==expected.binary.sha256)throw Error('CLI binary differs from its build record');
 if(record.bunLockSha256!==expected.bunLockSha256)throw Error('CLI dependency lock changed; rebuild before packaging');
 if(record.compile?.minify!==true||record.compile?.bundled!==true)throw Error('CLI compile settings differ from the release profile');
 return expected;
}
