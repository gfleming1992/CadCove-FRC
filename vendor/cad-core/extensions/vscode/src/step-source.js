import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {inside,relativePath} from './project-files.js';

export const isStepFile = file => /\.(step|stp)$/i.test(file);
export const stepEntry = relative => '__step_preview__/'+relativePath(relative)+'.py';

export async function readStepSource(root,relative) {
  if(!isStepFile(relative))throw Error('Choose a STEP or STP file');
  const file=await inside(root,relative),info=await fs.stat(file);
  if(!info.isFile()||info.size>512*1024*1024)throw Error('STEP preview requires a file of at most 512 MiB');
  const digest=createHash('sha256');
  for await(const bytes of createReadStream(file))digest.update(bytes);
  const sha=digest.digest('hex');
  return {[stepEntry(relative)]:`# Native STEP preview: ${sha}\n`,[relative]:'sha256:'+sha};
}
