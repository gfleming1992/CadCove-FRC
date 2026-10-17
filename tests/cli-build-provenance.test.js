import {test,expect} from 'bun:test';
import {bunRelease,cliCompilerRecord,cliBuildRecord,externalCliBuildRecord,validateCliBuild} from '../lib/cli-build-provenance.js';
import {rustRelease} from '../lib/native-build-provenance.js';
const target='darwin-arm64',version='0.1.0-test',binary=Buffer.from('compiled CLI'),lock=Buffer.from('locked dependencies');
const compiler=cliCompilerRecord(Buffer.from('observed compiler'),{...bunRelease,target});
const record=()=>cliBuildRecord(binary,lock,{compiler,target,version});

test('CLI build identity retains public fields only',()=>{
 const input=record();input.compiler.path='/Users/private/compiler';input.path='/Users/private/cli';
 const result=validateCliBuild(input,binary,lock,{target,version});
 expect(result).toEqual(record());expect(JSON.stringify(result)).not.toContain('/Users/');
});

test('external runtime binds launcher, script, source and qualified compiler',()=>{
 const script=Buffer.from('bundled script'),launcherSource=Buffer.from('launcher Rust');
 const launcherCompiler={...rustRelease,host:'aarch64-apple-darwin'};
 const input=externalCliBuildRecord(binary,script,launcherSource,lock,{compiler,launcherCompiler,target,version});
 const options={target,version,script,launcherSource};
 expect(validateCliBuild(input,binary,lock,options)).toEqual(input);
 for(const field of ['script','launcherSource'])expect(()=>validateCliBuild(input,binary,lock,{...options,[field]:Buffer.from('tampered')})).toThrow('mismatch');
 const wrong=structuredClone(input);wrong.launcherCompiler.host='x86_64-pc-windows-msvc';
 expect(()=>validateCliBuild(wrong,binary,lock,options)).toThrow('host');
 expect(()=>validateCliBuild(input,binary,lock,{target,version})).toThrow('requires script');
});
test('CLI packaging rejects mismatched binary, dependencies, target, version and compiler',()=>{
 expect(()=>validateCliBuild(record(),Buffer.from('other CLI'),lock,{target,version})).toThrow('binary');
 expect(()=>validateCliBuild(record(),binary,Buffer.from('other lock'),{target,version})).toThrow('lock changed');
 for(const edit of [r=>r.schema=2,r=>r.target='linux-x64',r=>r.version='0.2.0',r=>r.compiler.revision='0'.repeat(40),r=>r.compiler.version='1.4.3',r=>r.compiler.target='linux-x64',r=>r.compiler.binary.sha256='bad',r=>r.compile.minify=false,r=>r.compile.bundled=false]){
  const input=record();edit(input);expect(()=>validateCliBuild(input,binary,lock,{target,version})).toThrow();
 }
 expect(()=>cliCompilerRecord(Buffer.from('compiler'),{...bunRelease,revision:'unknown',target})).toThrow('reviewed Bun');
});
