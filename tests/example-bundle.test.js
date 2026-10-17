import {test,expect} from 'bun:test';
import {decodeExampleBundle,exampleRequiredFiles,exampleDigest} from '../lib/example-bundle.js';

function fixture(){
 const files=exampleRequiredFiles.map(file=>({path:file,data:Buffer.from('fixture '+file)}));
 const helper=files.find(f=>f.path==='vendor/limelight/upstream.json');
 helper.data=Buffer.from(JSON.stringify({files:Object.fromEntries(['LICENSE','LimelightHelpers.java'].map(name=>[name,exampleDigest(files.find(f=>f.path==='vendor/limelight/'+name).data)]))}));
 return {schema:1,id:'training-robot',files:files.map(f=>({path:f.path,bytes:f.data.length,sha256:exampleDigest(f.data),data:f.data.toString('base64')}))};
}
test('decodes byte-identical source and rejects corrupted, incomplete or escaping bundles',()=>{
 const original=fixture(),decoded=decodeExampleBundle(original);expect(decoded.size).toBe(exampleRequiredFiles.length);
 expect(decoded.get('cad/models.py').toString()).toBe('fixture cad/models.py');
 for(const change of [
  b=>b.files.push({...b.files[0],path:'../outside.txt'}),
  b=>b.files.push({...b.files[0],path:'build/libs/robot.jar'}),
  b=>b.files.push({...b.files[0]}),
  b=>b.files.shift(),
  b=>b.files[0].data+='!',
  b=>b.files[0].bytes++,
  b=>b.files[0].sha256='0'.repeat(64),
  b=>b.id='some-team',
 ]){const bundle=structuredClone(original);change(bundle);expect(()=>decodeExampleBundle(bundle)).toThrow();}
 const bundle=structuredClone(original),helper=bundle.files.find(f=>f.path==='vendor/limelight/upstream.json');
 const changed=Buffer.from(JSON.stringify({files:{}}));Object.assign(helper,{data:changed.toString('base64'),bytes:changed.length,sha256:exampleDigest(changed)});
 expect(()=>decodeExampleBundle(bundle)).toThrow('Limelight source pin');
});
