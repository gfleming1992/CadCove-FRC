import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
// Resolve symlinks before allowing a local artifact to be opened by the editor.
export async function svgPreviewFile(workspace,file){
 if(typeof file!=='string'||!file.toLowerCase().endsWith('.svg'))throw Error('Choose a workspace SVG file');
 const root=await fs.realpath(workspace),absolute=await fs.realpath(path.resolve(root,file));
 const relative=path.relative(root,absolute);
 if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('SVG preview must be inside the workspace');
 const stat=await fs.stat(absolute);
 if(!stat.isFile()||stat.size>32*1024*1024)throw Error('SVG preview requires a regular file no larger than 32 MiB');
 const bytes=await fs.readFile(absolute);
 if(!/<svg[\s>]/i.test(bytes.toString('utf8')))throw Error('File does not contain SVG');
 return {file:absolute,sha256:createHash('sha256').update(bytes).digest('hex')};
}
