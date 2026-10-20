import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {relativePath} from '../vendor/cad-core/extensions/vscode/src/project-files.js';

export async function cadProjectSettings(workspace) {
 const value=JSON.parse(await readFile(path.join(workspace,'.cadcove/project.json'),'utf8'));
 if(value.schema!==1||typeof value.sourceDirectory!=='string'||typeof value.buildDirectory!=='string'||typeof value.entryPoint!=='string')throw Error('Invalid .cadcove/project.json; initialize this team workspace first.');
 if(value.sourceDirectory!=='.')relativePath(value.sourceDirectory);
 relativePath(value.buildDirectory);relativePath(value.entryPoint);
 if(value.pythonPath!==undefined&&(typeof value.pythonPath!=='string'||!value.pythonPath.trim()))throw Error('pythonPath must be a nonempty Python executable path');
 return {...(value.pythonPath?{pythonPath:value.pythonPath}:{}),sourceDirectory:value.sourceDirectory,buildDirectory:path.posix.join(value.buildDirectory,'cad-cache'),entryPoint:value.entryPoint};
}
