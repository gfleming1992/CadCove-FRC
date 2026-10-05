import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

export const rustRelease = Object.freeze({version:'1.91.1',commit:'ed61e7d7e242494fb7057f2657300d9e77bb4fcb'});
export const nativeFeatures = ['composite-compact'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hosts = {'darwin-arm64':'aarch64-apple-darwin','darwin-x64':'x86_64-apple-darwin','linux-x64':'x86_64-unknown-linux-gnu','linux-arm64':'aarch64-unknown-linux-gnu','win32-x64':'x86_64-pc-windows-msvc'};

export function parseRustCompiler(output, target = process.platform+'-'+process.arch) {
  const fields = Object.fromEntries(output.trim().split(/\r?\n/).slice(1).map(line => {
    const split=line.indexOf(': '); return [line.slice(0,split),line.slice(split+2)];
  }));
  if(fields.release!==rustRelease.version || fields['commit-hash']!==rustRelease.commit)
    throw Error('Native release requires the reviewed Rust '+rustRelease.version+' toolchain');
  if(!hosts[target] || fields.host!==hosts[target]) throw Error('Rust compiler host does not match the packaged platform');
  return {version:fields.release,commit:fields['commit-hash'],host:fields.host};
}

export function nativeBuildRecord(binary, lock, compiler, target = process.platform+'-'+process.arch) {
  return {schema:1,target,compiler,features:[...nativeFeatures],binary:{bytes:binary.length,sha256:digest(binary)},cargoLockSha256:digest(lock)};
}

// This is a release-engineering consistency check, not a signature or proof
// against a malicious build host. CI must build and test the supplied binary.
export function validateNativeBuild(record, binary, lock, target = process.platform+'-'+process.arch) {
  if(record?.schema!==1 || record.target!==target) throw Error('Invalid native build platform/record');
  const c=record.compiler;
  if(c?.version!==rustRelease.version || c.commit!==rustRelease.commit || c.host!==hosts[target] || !hosts[target])
    throw Error('Native binary uses an unreviewed Rust compiler');
  if(JSON.stringify(record.features)!==JSON.stringify(nativeFeatures)) throw Error('Native build features do not match the release inventory');
  const expected=nativeBuildRecord(binary,lock,c,target);
  if(record.binary?.bytes!==expected.binary.bytes || record.binary?.sha256!==expected.binary.sha256)
    throw Error('Native binary does not match its build record; rebuild before packaging');
  if(record.cargoLockSha256!==expected.cargoLockSha256) throw Error('Native build dependency lock changed; rebuild before packaging');
  // Return only public fields; never carry paths/unknown properties into a release.
  return {...expected,compiler:{version:c.version,commit:c.commit,host:c.host}};
}

export async function readNativeBuild(binaryPath, lockPath) {
  const [binary,lock,record]=await Promise.all([readFile(binaryPath),readFile(lockPath),readFile(binaryPath+'.build.json','utf8')]);
  return validateNativeBuild(JSON.parse(record),binary,lock);
}
