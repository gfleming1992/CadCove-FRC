import * as esbuild from 'esbuild';
import path from 'node:path';
// Bundle only the supplied immutable source snapshot. No disk resolution,
// Node built-ins, native addons, network imports, or extension-host evaluation.
export async function compileModel(files,entry) {
  if(!Object.hasOwn(files,entry))throw Error(`Missing model entry: ${entry}`);
  const result=await esbuild.build({
    entryPoints:[entry],bundle:true,write:false,format:'cjs',platform:'browser',target:'es2022',
    logLevel:'silent',plugins:[{name:'cad-snapshot',setup(build){
      build.onResolve({filter:/.*/},args=>{
        if(args.path==='brepjs')return {path:'brepjs',external:true};
        let target;
        if(args.kind==='entry-point')target=entry;
        else {
          if(!args.path.startsWith('.'))throw Error(`Unsupported model import: ${args.path}`);
          target=path.posix.normalize(path.posix.join(path.posix.dirname(args.importer),args.path));
        }
        if(target.startsWith('../')||target.startsWith('/')||!Object.hasOwn(files,target))throw Error(`Missing project module: ${target}`);
        return {path:target,namespace:'cad'};
      });
      build.onLoad({filter:/.*/,namespace:'cad'},args=>({contents:files[args.path],loader:'js'}));
    }}],
  });
  return result.outputFiles[0].text;
}
