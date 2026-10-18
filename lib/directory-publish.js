import {rename,lstat,rm} from 'node:fs/promises';

// Only use for a private staging directory created by this operation. Bun 1.4.2
// on Windows does not retry a busy directory for fs.rm's maxRetries option.
export async function removeStagingDirectory(directory,{timeout=30000}={}) {
  const deadline=Date.now()+timeout;
  for(;;){
    try{await rm(directory,{recursive:true,force:true});return;}
    catch(error){
      if(process.platform!=='win32'||!['EPERM','EBUSY','ENOTEMPTY'].includes(error.code)||Date.now()>=deadline)throw error;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
  }
}

// Windows may retain a Gradle/antivirus directory handle briefly after a build.
// Retry only sharing failures, never delete or replace an existing destination.
export async function publishDirectory(source,destination,{timeout=30000}={}) {
  const deadline=Date.now()+timeout;
  for(;;){
    try{await lstat(destination);throw Error('Output already exists: '+destination);}
    catch(error){if(error.code!=='ENOENT')throw error;}
    try{await rename(source,destination);return;}
    catch(error){
      if(process.platform!=='win32'||!['EPERM','EBUSY'].includes(error.code)||Date.now()>=deadline)throw error;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
  }
}
