// Resumable, explicit one-time import of the source workbook into Oracle raw snapshot.
// Runs on demand only. Never deletes any source data or operational worksheets.
const BASE=(process.env.DEEPSTATS_URL||'https://deepstats-mobile.vercel.app').replace(/\/$/,'');
const TOKEN=process.env.ADMIN_ACCESS_TOKEN;
if(!TOKEN)throw Error('ADMIN_ACCESS_TOKEN missing');
const TABS=['СЕЛЕКЦИИ','АРХИВ BEST','МАЧОВЕ JSON','СТРАТЕГИИ_ДАННИ','СТРАТЕГИИ','БЕТА СТРАТЕГИИ','ДАННИ','ИСТОРИЯ КОЕФ.','ИСТОРИЯ_СТРАТЕГИИ','АРХИВ ВРЪЗКА','СТАТИСТИКА','ДНЕВЕН ЦЕНТЪР'];
const SIZE=Number(process.env.BATCH_SIZE||50);
if(!Number.isInteger(SIZE)||SIZE<1||SIZE>100)throw Error('BATCH_SIZE must be 1..100');
const allowWrite=process.env.MIGRATION_MODE==='live';
async function call(method,mode,args={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),55000);
 try{
  let suffix='';
  const init={method,headers:{Authorization:'Bearer '+TOKEN},signal:controller.signal};
  if(method==='GET')suffix='?'+new URLSearchParams({mode,...args}).toString();
  else{init.headers['Content-Type']='application/json';init.body=JSON.stringify({mode,...args});}
  const res=await fetch(BASE+'/api/oracle-lossless-import'+suffix,init);
  const txt=await res.text();let data;
  try{data=JSON.parse(txt)}catch{throw Error('Unexpected non-JSON response HTTP '+res.status)}
  if(!res.ok){const e=Error('HTTP '+res.status+' '+JSON.stringify(data).slice(0,600));e.code=res.status;throw e;}
  return data;
 }finally{clearTimeout(timer)}
}
async function retry(method,mode,args){
 let err;
 for(let k=0;k<3;k++){
  try{return await call(method,mode,args)}catch(e){
   err=e;
   if(![429,502,503,504].includes(e.code)||k===2)break;
   await new Promise(resolve=>setTimeout(resolve,(k+1)*2500));
  }
 }
 throw err;
}
const preflight=await retry('GET','preflight');
if(!preflight.ready||preflight.source!=='1iEufNQy8doCcfPA0LkHxPLvvXKiRKc60rH2dtyVx_oo')throw Error('Wrong source');
const sheets=new Map(preflight.tabs.map(t=>[t.name,t]));
let total=0,processed=0,empty=0;
for(const name of TABS){
 const tab=sheets.get(name);
 if(!tab)throw Error('Required tab missing: '+name);
 console.log('READ '+name+' ('+tab.rows+' rows, '+tab.cols+' columns)');
 let info={lastUsed:0,nonEmptyRows:0};
 for(let start=1;start<=tab.rows;start+=250){
  const fragment=await retry('GET','manifest',{tab:name,start:String(start),size:'250'});
  if(fragment.sheetId!==tab.id||fragment.day!==preflight.day||fragment.start!==start||fragment.end!==Math.min(start+249,tab.rows))throw Error('Inconsistent manifest '+name+' '+start);
  info.lastUsed=Math.max(info.lastUsed,fragment.lastUsed);
  info.nonEmptyRows+=fragment.nonEmptyRows;
 }
 console.log('MANIFEST '+name+' used rows '+info.nonEmptyRows+' last '+info.lastUsed);
 if(!allowWrite)continue;
 let used=0;
 for(let start=1;start<=info.lastUsed;start+=SIZE){
  const value=await retry('POST','batch',{tab:name,start,size:Math.min(SIZE,info.lastUsed-start+1),day:preflight.day,confirm:'MIGRATE_LOSSLESS_ORIGINAL'});
  if(!value.verified||value.tab!==name||value.day!==preflight.day||value.start!==start)throw Error('Migration verification failed '+name+' row '+start);
  used+=value.nonEmpty;processed+=value.nonEmpty;empty+=(value.end-value.start+1-value.nonEmpty);
  if(start%1000===1)console.log('VERIFIED '+name+' to row '+value.end);
 }
 if(used!==info.nonEmptyRows)throw Error('Non-empty count mismatch '+name+': '+used+' / '+info.nonEmptyRows);
 total+=used;
 console.log('MATCH '+name+': '+used+' verified rows');
}
if(!allowWrite){console.log('DRY RUN COMPLETE; nothing uploaded. Set MIGRATION_MODE=live to import.');process.exit(0)}
console.log('MIGRATION COMPLETE '+TABS.length+' sheets '+total+' verified nonempty rows; '+empty+' empty cells-only rows skipped');
