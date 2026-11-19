// Safe, authenticated, fail-closed synchronization. Source workbook is strictly read-only.
// The target preserves all derived columns, formatting and formulas. POST defaults to dry-run.
import {google} from 'googleapis';
import {timingSafeEqual,createHash} from 'node:crypto';
const SOURCE='1iEufNQy8doCcfPA0LkHxPLvvXKiRKc60rH2dtyVx_oo';
const TARGET='1yckF0vx9X1fido2pmTsp2i5BVVLCZ5TG32JCOseSBv8';
const TABS={
 selections:{name:'СЕЛЕКЦИИ',col:'Z',width:26,max:5401,chunk:40,key:[0,3,5]},
 best:{name:'АРХИВ BEST',col:'AY',width:51,max:20000,chunk:25,key:[0,3,5]},
 json:{name:'МАЧОВЕ JSON',col:'K',width:11,max:1063,chunk:12,key:[0,3,4]}
};
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const normalized=v=>v===null||v===undefined?'':String(v);
const hashes=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const same=(a,b)=>normalized(a)===normalized(b);
const formula=x=>typeof x==='string'&&x.startsWith('=');
const pad=(x,count,width)=>Array.from({length:count},(_,i)=>Array.from({length:width},(_,j)=>x[i]?.[j]??''));
const identity=(row,cols)=>cols.map(i=>normalized(row[i]).trim()).join('|');
function authz(req){
 const expected=String(process.env.ADMIN_ACCESS_TOKEN||'');
 const got=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
 const a=Buffer.from(got),b=Buffer.from(expected);
 return !!got&&!!expected&&a.length===b.length&&timingSafeEqual(a,b);
}
function plan(source,target,tab,start){
 const writes=[],conflicts=[];
 for(let i=0;i<source.length;i++){
  const s=source[i],d=target[i],sr=start+i;
  if(s.every(x=>!normalized(x))&&d.every(x=>!normalized(x)))continue;
  const sk=identity(s,tab.key),dk=identity(d,tab.key);
  const skey=tab.key.every(c=>normalized(s[c]))&&sk;
  const dkey=tab.key.every(c=>normalized(d[c]))&&dk;
  if(skey&&dkey&&skey!==dkey){conflicts.push({row:sr,type:'ROW_IDENTITY_CHANGED'});continue}
  if(!skey&&dkey){conflicts.push({row:sr,type:'SOURCE_ROW_MISSING'});continue}
  if(!skey&&s.some(x=>normalized(x))&&d.some(x=>normalized(x))&&s.some((v,j)=>!same(v,d[j]))){
   conflicts.push({row:sr,type:'UNKEYED_ROW_CHANGED'});continue;
  }
  for(let j=0;j<tab.width;j++){
   const a=s[j],b=d[j];
   if(same(a,b))continue;
   if(formula(a)||formula(b)){conflicts.push({row:sr,col:j+1,type:'FORMULA_DIFFERENCE'});continue}
   if(!normalized(a)){conflicts.push({row:sr,col:j+1,type:'SOURCE_CLEAR_REQUIRES_REVIEW'});continue}
   if(!skey&&normalized(b)){conflicts.push({row:sr,col:j+1,type:'UNKEYED_OVERWRITE'});continue}
   // Preserve manually entered selections, results, and checkboxes in the new workbook.
   if([12,13].includes(j+1)&&normalized(b)){conflicts.push({row:sr,col:j+1,type:'MANUAL_FIELD_CONFLICT'});continue}
   writes.push({row:sr,col:j+1,value:a});
  }
 }
 return {writes,conflicts};
}
async function read(api,id,range,count,width){
 const r=await api.spreadsheets.values.get({spreadsheetId:id,range,valueRenderOption:'FORMULA'});
 return pad(r.data.values||[],count,width);
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(!authz(req))return res.status(403).json({error:'Forbidden'});
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
 const email=process.env.GOOGLE_CLIENT_EMAIL,key=process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g,'\n');
 if(!email||!key)return res.status(503).json({errorCode:'GOOGLE_CREDENTIALS_MISSING'});
 const api=google.sheets({version:'v4',auth:new google.auth.JWT({email,key,scopes:['https://www.googleapis.com/auth/spreadsheets']})});
 try{
  if(req.method==='GET'){
   const [src,dst]=await Promise.all([SOURCE,TARGET].map(spreadsheetId=>api.spreadsheets.get({spreadsheetId,fields:'spreadsheetId,sheets(properties(title,gridProperties(rowCount,columnCount)))'})));
   const fields=await Promise.all(Object.values(TABS).map(t=>api.spreadsheets.values.get({spreadsheetId:SOURCE,range:`${quote(t.name)}!A1:A${t.max}`,valueRenderOption:'FORMATTED_VALUE'})));
   const tabs=Object.entries(TABS).map(([id,t],i)=>{
    const a=src.data.sheets.find(s=>s.properties.title===t.name)?.properties;
    const b=dst.data.sheets.find(s=>s.properties.title===t.name)?.properties;
    const arr=fields[i].data.values||[];let last=arr.length;while(last>0&&!normalized(arr[last-1]?.[0]))last--;
    return {id,ready:!!(a&&b&&a.gridProperties.columnCount>=t.width&&b.gridProperties.columnCount>=t.width&&b.gridProperties.rowCount>=last),lastUsed:last,sourceCapacity:a?.gridProperties.rowCount,targetCapacity:b?.gridProperties.rowCount};
   });
   return res.status(tabs.every(t=>t.ready)?200:409).json({ready:tabs.every(t=>t.ready),source:SOURCE,target:TARGET,tabs});
  }
  const b=req.body||{},tab=TABS[b.sheet],start=Number(b.start),count=Number(b.count);
  if(!tab||!Number.isInteger(start)||start<1||!Number.isInteger(count)||count<1||count>tab.chunk||start+count-1>tab.max)
   return res.status(400).json({errorCode:'INVALID_CHUNK'});
  if(SOURCE===TARGET)return res.status(409).json({errorCode:'SOURCE_EQUALS_TARGET'});
  const range=`${quote(tab.name)}!A${start}:${tab.col}${start+count-1}`;
  const [s,d]=await Promise.all([read(api,SOURCE,range,count,tab.width),read(api,TARGET,range,count,tab.width)]);
  const result=plan(s,d,tab,start);
  const sourceHash=hashes(s),targetHash=hashes(d);
  const dry=b.dryRun!==false;
  if(result.conflicts.length||dry)return res.status(result.conflicts.length?409:200).json({sheet:b.sheet,start,count,dryRun:dry,verified:!result.conflicts.length&&result.writes.length===0,plannedCells:result.writes.length,conflicts:result.conflicts.slice(0,30),sourceHash,targetHash});
  if(b.confirm!=='SYNC_SAFE_MASTER_TABS'||b.expectedSourceHash!==sourceHash||b.expectedTargetHash!==targetHash)
   return res.status(409).json({errorCode:'STALE_OR_UNCONFIRMED',sourceHash,targetHash});
  // Recheck both sheets just before committing; abort rather than overwriting concurrent edits.
  const [s2,d2]=await Promise.all([read(api,SOURCE,range,count,tab.width),read(api,TARGET,range,count,tab.width)]);
  if(hashes(s2)!==sourceHash||hashes(d2)!==targetHash)return res.status(409).json({errorCode:'CONCURRENT_EDIT'});
  // Make precise single-cell RAW updates only for original source columns.
  // A single batch is bounded to 40 rows, and never targets added ID columns.
  const col=n=>{let out='';while(n){n--;out=String.fromCharCode(65+n%26)+out;n=Math.floor(n/26)}return out};
  const ranges=result.writes.map(x=>({range:`${quote(tab.name)}!${col(x.col)}${x.row}`,values:[[x.value]]}));
  if(ranges.length)await api.spreadsheets.values.batchUpdate({spreadsheetId:TARGET,requestBody:{valueInputOption:'RAW',data:ranges}});
  const after=await read(api,TARGET,range,count,tab.width);
  const verified=hashes(s)===hashes(after);
  return res.status(verified?200:409).json({sheet:b.sheet,start,count,verified,writtenCells:ranges.length,sourceHash,targetHash:hashes(after),errorCode:verified?undefined:'READBACK_MISMATCH'});
 }catch(e){console.error('safe-master-sync',e.response?.status||e.code||'UNKNOWN');return res.status(503).json({errorCode:'SYNC_UNAVAILABLE',code:e.response?.status||e.code||'UNKNOWN'});}
}
