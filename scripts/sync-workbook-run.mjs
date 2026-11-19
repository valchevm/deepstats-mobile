/**
 * Safe master-tab synchronizer orchestrator.
 * Default is DRY RUN. Set SYNC_MODE=live to commit only after a successful,
 * complete preflight against the original and the new workbook.
 * The target is the NEW workbook only; a conflict fails closed.
 */
const BASE=(process.env.DEEPSTATS_URL||'https://deepstats-mobile.vercel.app').replace(/\/$/,'');
const TOKEN=process.env.ADMIN_ACCESS_TOKEN;
if(!TOKEN)throw Error('ADMIN_ACCESS_TOKEN is required');
const mode=process.env.SYNC_MODE||'dry';
if(!['dry','live'].includes(mode))throw Error('Invalid SYNC_MODE');
const now=new Date();
const sofiaHour=Number(new Intl.DateTimeFormat('en-GB',{hour:'2-digit',hourCycle:'h23',timeZone:'Europe/Sofia'}).format(now));
if(process.env.GITHUB_EVENT_NAME==='schedule'&&![7,18].includes(sofiaHour)){
 console.log('Skipping duplicate DST cron: Sofia hour '+sofiaHour);process.exit(0);
}
async function request(method,body){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),55000);
 try{
  const response=await fetch(BASE+'/api/sync-workbook',{
   method,headers:{Authorization:'Bearer '+TOKEN,...(body?{'Content-Type':'application/json'}:{})},
   body:body?JSON.stringify(body):undefined,signal:controller.signal});
  const raw=await response.text();let data;
  try{data=JSON.parse(raw)}catch{throw Error('Invalid sync response '+response.status+' '+raw.slice(0,160))}
  if(!response.ok){const e=Error('SYNC HTTP '+response.status+': '+JSON.stringify(data).slice(0,900));e.status=response.status;throw e}
  return data;
 }finally{clearTimeout(timer)}
}
async function retry(method,body){
 let last;for(let i=0;i<3;i++){
  try{return await request(method,body)}catch(e){last=e;if(![429,502,503,504].includes(e.status)||i===2)break;
   console.warn('Transient sync read error, retry '+(i+1));await new Promise(r=>setTimeout(r,1500*(i+1)));
  }
 }
 throw last;
}
const manifest=await retry('GET');
if(!manifest.ready||manifest.tabs?.length!==3)throw Error('Three-tab synchronization preflight failed: '+JSON.stringify(manifest));
const required=['selections','best','json'];
const entries=required.map(key=>{
 const t=manifest.tabs.find(x=>x.id===key);
 if(!t||!t.ready||!Number.isInteger(t.lastUsed)||t.lastUsed<1)throw Error('Invalid tab manifest '+key);
 return {key,rows:t.lastUsed,step:key==='json'?12:key==='best'?25:40};
});
console.log('Source tabs: '+JSON.stringify(entries));
const preview=[];
for(const t of entries){
 for(let start=1;start<=t.rows;start+=t.step){
  const count=Math.min(t.step,t.rows-start+1);
  const d=await retry('POST',{sheet:t.key,start,count,dryRun:true});
  if(d.conflicts?.length)throw Error('Unsafe source difference '+t.key+' row '+start);
  preview.push({sheet:t.key,start,count,sourceHash:d.sourceHash,targetHash:d.targetHash,changed:d.plannedCells});
 }
}
console.log('PREVIEW OK '+preview.length+' chunks; total changed cells '+preview.reduce((a,x)=>a+x.changed,0));
if(mode==='dry'){console.log('SYNC PREVIEW COMPLETE. No workbook writes.');process.exit(0)}
let written=0;
for(const job of preview.filter(x=>x.changed)){
 const done=await retry('POST',{
  sheet:job.sheet,start:job.start,count:job.count,dryRun:false,
  confirm:'SYNC_SAFE_MASTER_TABS',
  expectedSourceHash:job.sourceHash,expectedTargetHash:job.targetHash
 });
 if(!done.verified)throw Error('Sync failed verification: '+job.sheet+' '+job.start);
 written+=done.writtenCells||0;
 console.log('VERIFIED '+job.sheet+' rows '+job.start+'-'+(job.start+job.count-1)+' cells '+done.writtenCells);
}
console.log('MASTER SYNC SUCCESS: '+written+' cells updated and verified');
