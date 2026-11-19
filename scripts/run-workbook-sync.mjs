// Hourly, three-tab incremental sync orchestrator.
// Uses admin-authenticated Vercel API; Google credentials stay on the Vercel server.
const BASE=(process.env.DEEPSTATS_URL||'https://deepstats-mobile.vercel.app').replace(/\/$/,'');
const token=process.env.ADMIN_ACCESS_TOKEN;
if(!token)throw Error('Missing ADMIN_ACCESS_TOKEN');
const dry=process.env.SYNC_LIVE!=='1';
async function call(method,path,payload){
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),55000);
 try{
  const r=await fetch(BASE+path,{method,headers:{Authorization:'Bearer '+token,...(payload?{'Content-Type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined,signal:ctrl.signal});
  const raw=await r.text();let body;try{body=JSON.parse(raw)}catch{throw Error('Non-JSON HTTP '+r.status+': '+raw.slice(0,120))}
  if(!r.ok)throw Error('HTTP '+r.status+' '+JSON.stringify(body));
  return body;
 }finally{clearTimeout(timer)}
}
async function retry(method,path,payload){
 let last;
 for(let i=0;i<3;i++){try{return await call(method,path,payload)}catch(e){last=e;if(/HTTP (400|401|403|404|409)\b/.test(e.message))break;console.warn(e.message);if(i<2)await new Promise(r=>setTimeout(r,1500*(i+1)))}}
 throw last;
}
const state=await retry('GET','/api/sync-workbook');
if(!state.ready)throw Error('Missing source or target tabs: '+JSON.stringify(state.tabs));
let changed=0,checked=0;
for(const tab of state.tabs){
 const chunk={selections:50,best:25,json:20}[tab.key];
 if(!chunk)throw Error('Unexpected tab '+tab.key);
 for(let start=1;start<=tab.lastUsed;start+=chunk){
  const count=Math.min(chunk,tab.lastUsed-start+1);
  const payload={sheet:tab.key,start,count,dryRun:true};
  const preview=await retry('POST','/api/sync-workbook',payload);
  checked+=count;
  if(!preview.changedRows)continue;
  console.log('DIFF '+tab.key+' rows '+start+'-'+(start+count-1)+' changed '+preview.changedRows);
  if(dry)continue;
  const result=await retry('POST','/api/sync-workbook',{...payload,dryRun:false});
  if(result.verified!==true)throw Error('Unverified update '+tab.key+' rows '+start);
  changed+=result.changedRows;
 }
 console.log('SYNC TAB '+tab.key+' verified scan up to row '+tab.lastUsed);
}
console.log(JSON.stringify({status:dry?'DRY_RUN_COMPLETE':'LIVE_SYNC_VERIFIED',checkedRows:checked,writtenRows:changed,tabs:state.tabs.map(x=>({name:x.key,lastUsed:x.lastUsed}))}));
