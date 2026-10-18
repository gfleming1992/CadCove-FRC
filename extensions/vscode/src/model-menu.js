// This is a source hint for the Explorer menu, not a Python validator. Never
// execute a workspace file just to decide whether to offer its preview action.
export function isPythonModel(source) {
  // Mask comments and strings (including multiline docstrings), preserving
  // indentation/newlines so examples and nested methods don't become entries.
  const code=source.replace(/#[^\r\n]*|'''(?:\\[\s\S]|(?!''')[\s\S])*'''|"""(?:\\[\s\S]|(?!""")[\s\S])*"""|'(?:\\[\s\S]|[^'\\\r\n])*'|"(?:\\[\s\S]|[^"\\\r\n])*"/g,
    token=>token.replace(/[^\r\n]/g,' '));
  return /^(?:def[ \t]+build[ \t]*\(|(?:result|build)[ \t]*(?::[^=\r\n]+)?=(?!=))/m.test(code.replace(/^\uFEFF/,''));
}

const PYTHON='**/*.{py,PY}';
const EXCLUDE='**/{.git,.venv,venv,node_modules,__pycache__,target,.instantcad}/**';
const CONTEXT='cadcove.modelEntryPaths';

export function registerModelMenu(vscode,context) {
  const entries=new Set(),pending=new Map();
  let disposed=false,draining=false,revision=0,publishTimer;
  const key=uri=>uri.fsPath;
  const eligible=uri=>{
    const folder=vscode.workspace.getWorkspaceFolder(uri);
    return uri.scheme==='file'&&/\.py$/i.test(uri.fsPath)&&folder&&
      !/(?:^|[\\/])(?:\.git|\.venv|venv|node_modules|__pycache__|target|\.instantcad)(?:[\\/]|$)/.test(uri.fsPath.slice(folder.uri.fsPath.length));
  };
  function publish(){
    clearTimeout(publishTimer);
    publishTimer=setTimeout(()=>{
      if(!disposed)void vscode.commands.executeCommand('setContext',CONTEXT,[...entries]).then(undefined,()=>{});
    },20);
  }
  async function drain(){
    if(draining||disposed)return;
    draining=true;
    try{
      while(pending.size&&!disposed){
        const [file,uri]=pending.entries().next().value;
        pending.delete(file);
        const version=revision;
        let model=false;
        if(uri&&eligible(uri)){
          try{
            // Avoid loading dependency blobs or unrelated huge generated files.
            const stat=await vscode.workspace.fs.stat(uri);
            if(stat.size<=8*1024*1024)model=isPythonModel(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'));
          }catch{/* Deleted/unreadable files do not get a preview action. */}
        }
        if(disposed||version!==revision||pending.has(file))continue;
        const changed=model?!entries.has(file):entries.has(file);
        if(model)entries.add(file);else entries.delete(file);
        if(changed)publish();
      }
    }finally{draining=false;}
  }
  function update(uri){if(!disposed&&eligible(uri)){pending.set(key(uri),uri);void drain();}}
  function remove(uri){
    if(disposed)return;
    pending.set(key(uri),null);
    if(entries.delete(key(uri)))publish();
    void drain();
  }
  async function created(uri){
    if(/\.py$/i.test(uri.fsPath)){update(uri);return;}
    const folder=vscode.workspace.getWorkspaceFolder(uri);
    if(uri.scheme!=='file'||!folder||/(?:^|[\\/])(?:\.git|\.venv|venv|node_modules|__pycache__|target|\.instantcad)(?:[\\/]|$)/.test(uri.fsPath.slice(folder.uri.fsPath.length)))return;
    // A directory created by an external tool can arrive as one event on
    // macOS, without separate events for the files already inside it.
    try{
      if(!((await vscode.workspace.fs.stat(uri)).type&2)||disposed)return;
      const files=await vscode.workspace.findFiles(new vscode.RelativePattern(uri,PYTHON),EXCLUDE);
      for(const file of files)update(file);
    }catch{/* Directory was removed before it could be indexed. */}
  }
  async function scan(){
    const version=++revision;
    pending.clear();entries.clear();publish();
    try{
      const files=await vscode.workspace.findFiles(PYTHON,EXCLUDE);
      if(disposed||version!==revision)return;
      for(const uri of files)if(eligible(uri))pending.set(key(uri),uri);
      void drain();
    }catch{/* A removed workspace may cancel its search. */}
  }
  let watchers=[];
  function watchFolders(){
    for(const watcher of watchers)watcher.dispose();watchers=[];
    for(const folder of vscode.workspace.workspaceFolders??[]){
      const watcher=vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder,'**/*'));
      watchers.push(watcher,watcher.onDidCreate(created),watcher.onDidChange(update),watcher.onDidDelete(uri=>{
        for(const file of entries)if(file.startsWith(uri.fsPath+'/')||file.startsWith(uri.fsPath+'\\'))remove({fsPath:file});
        remove(uri);
      }));
    }
  }
  watchFolders();
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(document=>update(document.uri)),
    vscode.workspace.onDidChangeWorkspaceFolders(()=>{watchFolders();void scan();}),
    {dispose(){disposed=true;revision++;for(const watcher of watchers)watcher.dispose();clearTimeout(publishTimer);pending.clear();entries.clear();}});
  void scan();
  return {entries:()=>[...entries]};
}
