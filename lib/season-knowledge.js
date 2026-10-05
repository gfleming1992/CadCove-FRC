import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,lstat,realpath,rename,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile),sha=b=>createHash('sha256').update(b).digest('hex');
const maxBytes=64*1024*1024;

export function validateSeasonPack(p){
 if(p?.schema!==1||!/^frc-[0-9]{4}-[a-z0-9-]{1,60}$/.test(p.id)||!Number.isInteger(p.year)||p.id.split('-')[1]!==String(p.year)||typeof p.game!=='string'||!p.game.trim()||p.game.length>100||p.language!=='en')throw Error('Invalid season descriptor');
 for(const key of ['manualUrl','updatesUrl','sourcePage']){const u=new URL(p[key]);if(u.protocol!=='https:'||u.username||u.password)throw Error('Season sources must be HTTPS without credentials');}
 return p;
}
async function safePath(root,relative){
 let at=root;for(const part of relative.split('/')){at=path.join(at,part);try{if((await lstat(at)).isSymbolicLink())throw Error('Knowledge paths must not follow symlinks');}catch(e){if(e.code!=='ENOENT')throw e;}}
 return at;
}
async function boundedRead(file){const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size>maxBytes)throw Error('Document must be a regular file no larger than 64 MiB');return readFile(file);}

// Local import only. We ship links, never download/redistribute FIRST's manual.
// pdftotext is optional; agent-produced page JSON is portable and must identify
// the exact PDF digest. Extraction fidelity still needs visual review.
export async function importSeasonKnowledge({workspace,packFile,pdf,pagesFile,revision,kind='manual'}){
 if(!workspace||!packFile||!pdf||typeof revision!=='string'||!revision.trim()||revision.length>160||/[\x00-\x1f]/.test(revision)||!['manual','updates'].includes(kind))throw Error('workspace, pack, PDF and revision are required; kind must be manual or updates');
 const root=await realpath(path.resolve(workspace)),pack=validateSeasonPack(JSON.parse(await boundedRead(packFile)));
 const source=await boundedRead(pdf);if(!source.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('Expected a PDF document');
 const sourceHash=sha(source);let pages,extraction;
 if(pagesFile){const v=JSON.parse(await boundedRead(pagesFile));if(v.sourceSha256!==sourceHash)throw Error('Extracted pages do not identify this PDF');pages=v.pages;extraction='user-supplied page text; not visually verified';}
 else{
  let stdout;try{({stdout}=await exec('pdftotext',['-layout','-enc','UTF-8',path.resolve(pdf),'-'],{maxBuffer:maxBytes,timeout:60000}));}
  catch(e){throw Error('PDF text extraction failed. Install pdftotext, or supply --pages JSON with sourceSha256 and pages (one string per PDF page). '+e.message);}
  pages=stdout.split('\f');if(!pages.at(-1)?.trim())pages.pop();extraction='pdftotext -layout; tables/figures require original PDF review';
  if(sha(await boundedRead(pdf))!==sourceHash)throw Error('PDF changed during extraction');
 }
 if(!Array.isArray(pages)||!pages.length||pages.length>2000||pages.some(t=>typeof t!=='string'||t.length>500000)||!pages.some(t=>t.trim())||Buffer.byteLength(pages.join(''))>maxBytes)throw Error('Invalid or empty page extraction; scanned PDFs need reviewed OCR');
 const contentHash=sha(JSON.stringify({pack,sourceHash,revision,kind,pages}));
 const relative=`.cadcove/knowledge/${pack.id}/${kind}-${contentHash}`;
 const directory=await safePath(root,relative),parent=path.dirname(directory);
 try{await lstat(directory);const manifest=await verifyKnowledge(directory);if(manifest.contentHash!==contentHash)throw Error('Knowledge identity mismatch');return {schema:1,ok:true,directory,reused:true,manifest};}catch(e){if(e.code!=='ENOENT')throw e;}
 await mkdir(parent,{recursive:true});await safePath(root,relative);
 // This subtree is a private local corpus, even when the workspace was not initialized.
 const ignore=await safePath(root,'.cadcove/knowledge/.gitignore');
 try{await writeFile(ignore,'*\n!.gitignore\n',{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;if(await readFile(ignore,'utf8')!=='*\n!.gitignore\n')throw Error('Knowledge ignore policy differs; keep imported documents private before importing');}
 const stage=path.join(parent,'.import-'+randomUUID());await mkdir(stage);const files=[];
 try{
  async function put(file,bytes){await writeFile(path.join(stage,file),bytes,{flag:'wx'});files.push({file,sha256:sha(bytes),bytes:Buffer.byteLength(bytes)});}
  await put('source.pdf',source);
  const index=[];
  for(const [i,text] of pages.entries()){
   const file=`page-${String(i+1).padStart(4,'0')}.md`;
   await put(file,`# ${pack.game} — ${kind} — PDF page ${i+1}\n\nSource SHA-256: ${sourceHash}\nRevision: ${revision}\n\n<!-- Extracted reference text; verify tables and figures in source.pdf. -->\n\n${text.trim()}\n`);
   index.push({page:i+1,file,ruleIds:[...new Set(text.match(/\b[GRHAT]\d{3,4}\b/g)||[])]});
  }
  await put('index.json',JSON.stringify({schema:1,pages:index},null,2)+'\n');
  const manifest={schema:1,pack,kind,revision,sourceHash,contentHash,extraction,pageCount:pages.length,files,authority:'Local reference copy; freshness and extraction fidelity require review',redistribution:false};
  await writeFile(path.join(stage,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  await rename(stage,directory);
  return {schema:1,ok:true,directory,reused:false,manifest,next:'Select this directory as seasonKnowledge in .cadcove/frc.json; retain separate manual and update revisions. Runtime field/observer are unchanged.'};
 }finally{await rm(stage,{recursive:true,force:true});}
}

export async function verifyKnowledge(directory){
 const s=await lstat(directory);if(!s.isDirectory()||s.isSymbolicLink())throw Error('Invalid knowledge directory');
 const m=JSON.parse(await boundedRead(path.join(directory,'manifest.json')));validateSeasonPack(m.pack);
 if(m.schema!==1||!/^[a-f0-9]{64}$/.test(m.contentHash)||!/^[a-f0-9]{64}$/.test(m.sourceHash)||!Number.isInteger(m.pageCount)||m.pageCount<1||m.pageCount>2000||!Array.isArray(m.files)||m.files.length!==m.pageCount+2)throw Error('Invalid knowledge manifest');
 const expected=new Set(['source.pdf','index.json',...Array.from({length:m.pageCount},(_,i)=>`page-${String(i+1).padStart(4,'0')}.md`)]);
 for(const f of m.files){if(!expected.delete(f.file))throw Error('Invalid/duplicate knowledge file');const bytes=await boundedRead(path.join(directory,f.file));if(f.bytes!==bytes.length||sha(bytes)!==f.sha256)throw Error('Knowledge checksum mismatch: '+f.file);}
 if(m.files.find(f=>f.file==='source.pdf').sha256!==m.sourceHash)throw Error('Source PDF identity mismatch');return m;
}
export async function searchSeasonKnowledge({directory,query,offset=0,limit=8}){
 if(!directory||typeof query!=='string'||!query.trim()||query.length>512)throw Error('directory and query (1–512 characters) are required');
 for(const [name,value,min,max] of [['offset',offset,0,2000],['limit',limit,1,20]])if(!/^[0-9]+$/.test(String(value))||!Number.isSafeInteger(Number(value))||Number(value)<min||Number(value)>max)throw Error(`${name} must be an integer from ${min} to ${max}`);
 offset=Number(offset);limit=Number(limit);
 const root=await realpath(path.resolve(directory)),manifest=await verifyKnowledge(root);
 const terms=[...new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu)||[])];if(!terms.length)throw Error('Query has no searchable terms');
 const documents=[],frequency=new Map(terms.map(term=>[term,0]));let totalLength=0;
 for(let page=1;page<=manifest.pageCount;page++){
  const file=`page-${String(page).padStart(4,'0')}.md`,text=await readFile(path.join(root,file),'utf8'),body=text.slice(text.indexOf('-->')+3);
  const counts=new Map(),positions=new Map();let length=0;
  for(const token of body.matchAll(/[\p{L}\p{N}]+/gu)){
   length++;const term=token[0].toLowerCase();if(!frequency.has(term))continue;
   counts.set(term,(counts.get(term)??0)+1);if(!positions.has(term))positions.set(term,token.index);
  }
  totalLength+=length;for(const term of counts.keys())frequency.set(term,frequency.get(term)+1);
  if(counts.size)documents.push({page,file,body,length,counts,positions});
 }
 // BM25 ranks substantive pages above incidental early mentions. Whole tokens
 // keep a rule ID such as R202 distinct from R2020; agents can search synonyms.
 const averageLength=totalLength/manifest.pageCount||1,k1=1.2,b=.75;
 const hits=documents.map(({page,file,body,length,counts,positions})=>{
  let score=0,bestContribution=-1,at=0;
  for(const [term,count] of counts){
   const df=frequency.get(term),idf=Math.log(1+(manifest.pageCount-df+.5)/(df+.5));
   const contribution=idf*count*(k1+1)/(count+k1*(1-b+b*length/averageLength));
   score+=contribution;if(contribution>bestContribution){bestContribution=contribution;at=positions.get(term);}
  }
  return {page,file:path.join(root,file),score,ruleIds:[...new Set(body.match(/\b[GRHAT]\d{3,4}\b/g)||[])],excerpt:body.slice(Math.max(0,at-100),at+700).trim(),pdf:`${path.join(root,'source.pdf')}#page=${page}`};
 });
 hits.sort((a,b)=>b.score-a.score||a.page-b.page);
 return {schema:1,ok:true,season:manifest.pack.id,kind:manifest.kind,revision:manifest.revision,sourceHash:manifest.sourceHash,search:'local lexical BM25, whole tokens; agent may additionally index page files',totalMatches:hits.length,offset,limit,nextOffset:offset+limit<hits.length?offset+limit:null,hits:hits.slice(offset,offset+limit),warning:'Ranking is retrieval relevance, not rule authority. Verify definitions, cross-references, updates and figures in the original. A search miss is not a rule exemption.'};
}
