import {test,expect} from 'bun:test';
import {nativeBuildRecord,parseRustCompiler,validateNativeBuild,rustRelease} from '../lib/native-build-provenance.js';

const compiler={...rustRelease,host:'aarch64-apple-darwin'};
const target='darwin-arm64',binary=Buffer.from('test binary'),lock=Buffer.from('test locked dependencies');
const record=()=>nativeBuildRecord(binary,lock,{...compiler},target);

test('release provenance accepts matching build and excludes unexpected/private properties',()=>{
 const input=record();input.privatePath='/Users/example/source';input.compiler.privatePath='/Users/example/rustc';
 const checked=validateNativeBuild(input,binary,lock,target);
 expect(checked.binary.bytes).toBe(binary.length);
 expect(JSON.stringify(checked)).not.toContain('/Users/');
});

test('release packaging rejects changed bytes, lock, compiler, features and target',()=>{
 expect(()=>validateNativeBuild(record(),Buffer.from('bad binary'),lock,target)).toThrow('binary');
 expect(()=>validateNativeBuild(record(),binary,Buffer.from('new lock'),target)).toThrow('lock changed');
 for(const edit of [r=>r.compiler.version='1.95.0',r=>r.compiler.commit='bad',r=>r.compiler.host='x86_64-apple-darwin',r=>r.features=[],r=>r.target='linux-x64',r=>r.schema=2]){
  const input=record();edit(input);expect(()=>validateNativeBuild(input,binary,lock,target)).toThrow();
 }
});

test('compiler inspection fails closed on a different release or host',()=>{
 const text=`rustc 1.91.1\nbinary: rustc\ncommit-hash: ${rustRelease.commit}\nhost: aarch64-apple-darwin\nrelease: 1.91.1\nLLVM version: 21.1.2\n`;
 expect(parseRustCompiler(text,target)).toEqual(compiler);
 expect(()=>parseRustCompiler(text.replace('release: 1.91.1','release: 1.95.0'),target)).toThrow('reviewed');
 expect(()=>parseRustCompiler(text,'win32-x64')).toThrow('host');
 expect(()=>parseRustCompiler('',target)).toThrow();
});
