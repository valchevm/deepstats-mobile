// Daily Oracle archive synchronization. Runs only at 12:00 Europe/Sofia.
// The admin secret stays in GitHub Actions secrets; never exposed to browsers.
const base=(process.env.DEEPSTATS_URL||'https://deepstats-mobile.vercel.app').replace(/\/$/,'');
const token=process.env.ADMIN_ACCESS_TOKEN;
if(!token)throw Error('Missing ADMIN_ACCESS_TOKEN GitHub Actions secret');
const now=new Date();
const local=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Sofia',hour:'2-digit',hourCycle:'h23'}).format(now);
if(process.env.GITHUB_EVENT_NAME==='schedule'&&Number(local)!==12){
 console.log('Skipping: Sofia local hour is '+local+', expected 12');
 process.exit(0);
}
async function call(path,body){
 const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),26000);
 try{
  const response=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:ctrl.signal});
  const raw=await response.text();
  let data;try{data=JSON.parse(raw)}catch{throw Error('Non-JSON response HTTP '+response.status+': '+raw.slice(0,160))}
  if(!response.ok)throw Error('HTTP '+response.status+': '+JSON.stringify(data));
  return data;
 }finally{clearTimeout(timer)}
}
async function retry(path,body){
 let last;
 for(let attempt=1;attempt<=3;attempt++){
  try{return await call(path,body)}catch(e){last=e;console.warn('Attempt '+attempt+' failed: '+e.message);if(attempt<3)await new Promise(r=>setTimeout(r,attempt*3000))}
 }
 throw last;
}
const preview=await retry('/api/oracle-import-odds-legacy');
if(preview.invalidRows)throw Error('Invalid legacy odds rows: '+preview.invalidRows);
console.log('Historical odds eligible: '+preview.historicalObservations);
let offset=0,processed=0;
while(offset<preview.historicalObservations){
 const result=await retry('/api/oracle-import-odds-legacy',{confirm:'IMPORT_LEGACY_ODDS',offset});
 if(!Number.isInteger(result.nextOffset)||result.nextOffset<=offset||result.processed<1)throw Error('Invalid batch progress at '+offset);
 offset=result.nextOffset;processed+=result.processed;
 console.log('Odds '+processed+'/'+preview.historicalObservations+'; stored '+result.totalStored);
}
const best=await retry('/api/oracle-import-best',{confirm:'IMPORT_ARCHIVE_BEST'});
console.log('Best archive import:',JSON.stringify(best));
const summary=await retry('/api/oracle-archive?kind=summary');
console.log('Verified Oracle totals:',JSON.stringify(summary));
if(summary.legacyOdds<preview.historicalObservations)throw Error('Oracle odds total below eligible source count');
console.log('DAILY ARCHIVE SUCCESS');
