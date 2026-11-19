// Complete daily, non-destructive Oracle snapshot of every Google Sheets row.
import {pathToFileURL} from 'node:url';
const BASE=(process.env.DEEPSTATS_URL||'https://deepstats-mobile.vercel.app').replace(/\/$/,'');
const TOKEN=process.env.ADMIN_ACCESS_TOKEN;
const MIN_REQUEST_INTERVAL_MS=Number(process.env.SNAPSHOT_REQUEST_INTERVAL_MS??'8000');
let lastLiveRequestAt=0;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function request(method,action,payload,{base=BASE,token=TOKEN,fetcher=fetch}={}){
 if(!token)throw Error('Missing ADMIN_ACCESS_TOKEN');
 if(!['GET','POST'].includes(method))throw Error('Unsupported method');
 if(method==='GET'&&!['preflight','manifest'].includes(action))throw Error('Unsupported GET action');
 if(method==='POST'&&!['batch','verify'].includes(action))throw Error('Unsupported POST action');
 const url=base+'/api/oracle-archive'+(method==='GET'?'?kind=raw-'+action:'');
 if(fetcher===fetch&&MIN_REQUEST_INTERVAL_MS>0){
  const gap=lastLiveRequestAt+MIN_REQUEST_INTERVAL_MS-Date.now();
  if(gap>0)await sleep(gap);
  lastLiveRequestAt=Date.now();
 }
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),55000);
 try{
  const options={method,headers:{Authorization:'Bearer '+token},signal:controller.signal};
  if(method==='POST'){options.headers['Content-Type']='application/json';options.body=JSON.stringify({...payload,action});}
  let response,responseText;
  try{response=await fetcher(url,options);responseText=await response.text()}
  catch(e){if(e.name==='AbortError'){const error=new Error('Snapshot request timed out ('+method+' '+action+', 55s): '+(payload?.sheetId??'preflight')+' / row '+(payload?.start??'-'));error.code='SNAPSHOT_REQUEST_TIMEOUT';throw error}throw e}
  let data;
  try{data=JSON.parse(responseText)}catch{throw Error('Invalid JSON from archive endpoint (HTTP '+response.status+'): '+responseText.slice(0,160))}
  if(!response.ok){
   const error=new Error('HTTP '+response.status+' '+JSON.stringify(data));
   error.status=response.status;
   error.errorCode=data.errorCode||data.error;
   error.retryAfterSeconds=Number(data.retryAfterSeconds||response.headers?.get?.('Retry-After')||0);
   error.quotaLimited=response.status===429||String(error.errorCode)==='429'||error.errorCode==='SHEETS_RATE_LIMITED';
   throw error;
  }
  return data;
 }finally{clearTimeout(timeout)}
}
export async function retry(method,action,payload,requestFn=request,{wait=sleep,onRetry=console.warn}={}){
 let last;
 for(let attempt=1;attempt<=7;attempt++){
  try{return await requestFn(method,action,payload)}catch(e){
   last=e;
   const quota=e.quotaLimited===true||e.status===429||String(e.errorCode)==='429'||e.errorCode==='SHEETS_RATE_LIMITED';
   const permanent=[400,401,403,404,409].includes(e.status)||['ARCHIVE_SCHEMA_SETUP_REQUIRED','ORA-01031','ORA-00942'].includes(e.errorCode);
   if(permanent||attempt===7)break;
   if(!quota&&!([502,503,504].includes(e.status)||e.code==='SNAPSHOT_REQUEST_TIMEOUT'))break;
   // Google Sheets project/user quotas reset per minute. Splitting a 429 batch
   // into many requests makes exhaustion worse: wait for the next quota window.
   const base=quota?Math.max(65000,Math.ceil((Number(e.retryAfterSeconds)||0)*1000)):Math.min(15000,2500*attempt);
   onRetry('Archive '+action+' retry '+attempt+'/6 after '+Math.ceil(base/1000)+'s ('+(quota?'Google Sheets quota':e.code||e.status)+')');
   await wait(base);
  }
 }
 throw last;
}
export async function archive({requestFn=request,log=console.log,wait=requestFn===request?sleep:async()=>{}}={}){
 const preflight=await retry('GET','preflight',undefined,requestFn,{wait});
 if(preflight.ready!==true)throw Error('Oracle archive preflight did not pass');
 log('ORACLE PREFLIGHT OK '+preflight.schema);
 const manifest=await retry('GET','manifest',undefined,requestFn,{wait});
 if(!/^\d{4}-\d{2}-\d{2}$/.test(manifest.day)||!Array.isArray(manifest.sheets)||manifest.sheets.length===0)throw Error('Invalid source manifest');
 if(new Set(manifest.sheets.map(x=>x.id)).size!==manifest.sheets.length)throw Error('Duplicate source sheet IDs');
 log('SNAPSHOT '+manifest.day+' SHEETS '+manifest.sheets.length);
 let total=0,skipped=0;
 async function processChunk(sh,start,size){
  const expected=Math.min(size,sh.rows-start+1);
  const payload={day:manifest.day,sheetId:sh.id,start,size:expected};
  // A matching Oracle hash for every row is the only basis for skipping.
  try{
   const prior=await retry('POST','verify',payload,requestFn,{wait});
   if(prior.verified===true&&prior.sheetId===sh.id&&prior.start===start&&prior.end===start+expected-1&&prior.rows===expected){
    skipped+=expected;total+=expected;log('SKIPPED VERIFIED '+sh.name+' rows '+start+'-'+(start+expected-1));return;
   }
  }catch(e){
   if(e.status!==409)throw e;
  }
  log('ARCHIVING '+sh.name+' rows '+start+'-'+(start+expected-1));
  let saved;
  try{saved=await retry('POST','batch',payload,requestFn)}
  catch(e){
   // Divide a slow/failed 500-row operation into smaller independently committed chunks.
   if(size>100&&!e.quotaLimited&&e.status!==429&&String(e.errorCode)!=='429'&&e.errorCode!=='SHEETS_RATE_LIMITED'&&(e.status===503||e.status===502||e.status===504||e.code==='SNAPSHOT_REQUEST_TIMEOUT')){
    const first=Math.ceil(expected/2),second=expected-first;
    log('REDUCING BATCH '+sh.name+' rows '+start+'-'+(start+expected-1)+' to '+first+' + '+second);
    await processChunk(sh,start,first);
    if(second)await processChunk(sh,start+first,second);
    return;
   }
   throw e;
  }
  if(saved.sheetId!==sh.id||saved.start!==start||saved.end!==start+expected-1||saved.count!==expected)throw Error('Archive row-count mismatch '+sh.name+' row '+start);
  const verified=await retry('POST','verify',{...payload,verification:'stored'},requestFn,{wait});
  if(verified.verified!==true||verified.sheetId!==sh.id||verified.start!==start||verified.end!==start+expected-1||verified.rows!==expected)throw Error('Oracle verification mismatch '+sh.name+' row '+start);
  total+=expected;
 }
 for(const sh of manifest.sheets){
  if(!Number.isInteger(sh.id)||!Number.isInteger(sh.rows)||sh.rows<1||!Number.isInteger(sh.cols)||sh.cols<1)throw Error('Invalid source dimensions for '+sh.name);
  // Archive stable rows first. Sheet headers/Best of the Day can shift while updating.
  // The deferred prefix is still archived and verified, never skipped.
  const firstStable=Math.min(sh.rows+1,26);
  for(let start=firstStable;start<=sh.rows;start+=500)await processChunk(sh,start,Math.min(500,sh.rows-start+1));
  if(firstStable>1){log('ARCHIVING DEFERRED TOP ROWS '+sh.name+' rows 1-'+(firstStable-1));await processChunk(sh,1,firstStable-1);}
  log('VERIFIED '+sh.name+' '+sh.rows+' rows');
 }
 log('REUSED VERIFIED ROWS '+skipped);
 log('RAW ORACLE SNAPSHOT VERIFIED '+manifest.day+' '+manifest.sheets.length+' sheets '+total+' rows');
 return {day:manifest.day,sheets:manifest.sheets.length,rows:total,verified:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await archive();
