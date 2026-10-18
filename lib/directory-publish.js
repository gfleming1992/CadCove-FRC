import {rename,lstat} from 'node:fs/promises';

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
