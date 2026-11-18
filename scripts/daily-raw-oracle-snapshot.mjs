// Daily complete, non-destructive Google Sheets snapshot in Oracle.
// Never deletes source rows; failed verification exits non-zero.
const base=(process.env.DEEPSTATS_URL||'https://deepstats-mobile.vercel.app').replace(/\/$/,'');
const token=process.env.ADMIN_ACCESS_TOKEN;
if(!token)throw Error('Missing ADMIN_ACCESS_TOKEN');
async function call(method,body){
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),55000);
 try{const r=await fetch(base+'/api/oracle-archive'+(method==='GET'?(body?.action==='preflight'?'?kind=raw-preflight':'?kind=raw-manifest'):''),{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:ctrl.signal});const data=await r.json();if(!r.ok)throw Error('HTTP '+r.status+' '+JSON.stringify(data));return data}finally{clearTimeout(timer)}
}
async function retry(method,body){let error;for(let n=0;n<3;n++){try{return await call(method,body)}catch(e){error=e;console.warn('Attempt '+(n+1)+' failed: '+e.message);if(/HTTP (400|401|403|404|409|503).*?(ARCHIVE_SCHEMA_SETUP_REQUIRED|ORA-01031|ORA-00942|Snapshot must be today|Invalid)/.test(e.message))throw e;if(n<2)await new Promise(r=>setTimeout(r,3000*(n+1)))}}throw error}
const ready=await retry('GET',{action:'preflight'});
if(ready.ready!==true)throw Error('Oracle archive preflight failed');
console.log('ORACLE SCHEMA READY: '+ready.schema);
const manifest=await retry('GET');
console.log('SNAPSHOT '+manifest.day+' '+manifest.sheets.length+' sheets');
let total=0;
for(const sh of manifest.sheets){
 for(let start=1;start<=sh.rows;start+=100){
  const r=await retry('POST',{action:'batch',day:manifest.day,sheetId:sh.id,start});
  if(r.start!==start||r.count!==Math.min(100,sh.rows-start+1))throw Error('Import batch count mismatch for '+sh.name+' at '+start);
  const verified=await retry('POST',{action:'verify',day:manifest.day,sheetId:sh.id,start});
  if(!verified.verified||verified.start!==start||verified.rows!==r.count)throw Error('Verification failed for '+sh.name+' at '+start);
  total+=r.count;
 }
 console.log('VERIFIED '+sh.name+' '+sh.rows+' rows');
}
console.log('RAW ORACLE SNAPSHOT VERIFIED '+manifest.day+' '+total+' rows');
