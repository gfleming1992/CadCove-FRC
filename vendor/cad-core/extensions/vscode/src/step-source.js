import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {inside,relativePath} from './project-files.js';
import {buildStepScene} from '../../../src/core/step-model.js';

export const isStepFile = file => /\.(step|stp)$/i.test(file);
export const stepEntry = relative => '__step_preview__/'+relativePath(relative)+'.js';

export async function readStepSource(root,relative) {
  if(!isStepFile(relative))throw Error('Choose a STEP or STP file');
  const file=await inside(root,relative),info=await fs.stat(file);
  if(!info.isFile()||info.size>512*1024*1024)throw Error('STEP preview requires a file of at most 512 MiB');
  const digest=createHash('sha256');
  for await(const bytes of createReadStream(file))digest.update(bytes);
  const sha=digest.digest('hex');
  // No generated source is written into the user's CAD folder. Its revision
  // includes the asset digest, so changing/replacing the STEP invalidates cache.
  return {[stepEntry(relative)]:`const buildStepScene=${buildStepScene.toString()};\nexport default async function(context){return buildStepScene(context,await context.readAsset(${JSON.stringify(relative)},${JSON.stringify(sha)}),${JSON.stringify(path.basename(relative))});}\n`};
}
