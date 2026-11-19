// Restricted, incremental Google Sheets copy: old workbook read-only, new workbook writes only.
import {google} from 'googleapis';
import {timingSafeEqual,createHash} from 'node:crypto';
const SOURCE='1iEufNQy8doCcfPA0LkHxPLvvXKiRKc60rH2dtyVx_oo';
const TARGET='1yckF0vx9X1fido2pmTsp2i5BVVLCZ5TG32JCOseSBv8';
const TABS={
 selections:{name:'СЕЛЕКЦИИ',col:'Z',width:26,max:5401,chunk:50},
 best:{name:'АРХИВ BEST',col:'AY',width:51,max:20000,chunk:25},
 json:{name:'МАЧОВЕ JSON',col:'K',width:11,max:1063,chunk:20}
};
const quote=s=>"'"+s.replace(/'/g,"''")+"'";
const full=(values,n,w)=>Array.from({length:n},(_,i)=>Array.from({length:w},(_,j)=>String(values[i]?.[j]??'')));
const digest=a=>createHash('sha256').update(JSON.stringify(a)).digest('hex');
function authorized(req){
 const expected=String(process.env.ADMIN_ACCESS_TOKEN||'');
 const got=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
 const a=Buffer.from(got),b=Buffer.from(expected);
 return !!got&&!!expected&&a.length===b.length&&timingSafeEqual(a,b);
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store, private');
 if(!authorized(req))return res.status(403).json({error:'Forbidden'});
 if(req.method!=='GET'&&req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const email=process.env.GOOGLE_CLIENT_EMAIL,key=process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g,'\n');
 if(!email||!key)return res.status(503).json({errorCode:'GOOGLE_CREDENTIALS_MISSING'});
 const auth=new google.auth.JWT({email,key,scopes:['https://www.googleapis.com/auth/spreadsheets']});
 const api=google.sheets({version:'v4',auth});
 try{
  if(req.method==='GET'){
   const [src,dst]=await Promise.all([SOURCE,TARGET].map(spreadsheetId=>api.spreadsheets.get({spreadsheetId,fields:'spreadsheetId,sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))'})));
   const tabs=Object.entries(TABS).map(([key,t])=>{
    const a=src.data.sheets.find(s=>s.properties.title===t.name)?.properties;
    const b=dst.data.sheets.find(s=>s.properties.title===t.name)?.properties;
    return {key,ready:!!(a&&b&&b.gridProperties.columnCount>=t.width&&b.gridProperties.rowCount>=a.gridProperties.rowCount),sourceRows:a?.gridProperties.rowCount,targetRows:b?.gridProperties.rowCount};
   });
   return res.status(tabs.every(t=>t.ready)?200:409).json({ready:tabs.every(t=>t.ready),tabs,source:SOURCE,target:TARGET});
  }
  const body=req.body||{},t=TABS[body.sheet];
  const start=Number(body.start),count=Number(body.count);
  if(!t||!Number.isInteger(start)||start<1||!Number.isInteger(count)||count<1||count>t.chunk||start+count-1>t.max)
   return res.status(400).json({errorCode:'INVALID_CHUNK'});
  if(SOURCE===TARGET)return res.status(409).json({errorCode:'SAME_WORKBOOK'});
  const range=`${quote(t.name)}!A${start}:${t.col}${start+count-1}`;
  const [a,b]=await Promise.all([SOURCE,TARGET].map(spreadsheetId=>api.spreadsheets.values.get({spreadsheetId,range,valueRenderOption:'FORMULA'})));
  const src=full(a.data.values||[],count,t.width),dst=full(b.data.values||[],count,t.width);
  const sourceHash=digest(src),targetHash=digest(dst);
  const dirty=src.map((row,i)=>JSON.stringify(row)!==JSON.stringify(dst[i]));
  const n=dirty.filter(Boolean).length;
  if(body.dryRun!==false)return res.status(200).json({dryRun:true,sheet:body.sheet,start,count,changedRows:n,sourceHash,targetHash});
  // Only modify original A:Z, A:AY or A:K. Never touch added ID columns.
  // Only contiguous differing rows are updated. Preserve destination's native formatting/validations.
  for(let i=0;i<count;){
   if(!dirty[i]){i++;continue}
   let j=i+1;while(j<count&&dirty[j])j++;
   const sub=`${quote(t.name)}!A${start+i}:${t.col}${start+j-1}`;
   await api.spreadsheets.values.update({spreadsheetId:TARGET,range:sub,valueInputOption:'USER_ENTERED',requestBody:{majorDimension:'ROWS',values:src.slice(i,j)}});
   i=j;
  }
  const check=await api.spreadsheets.values.get({spreadsheetId:TARGET,range,valueRenderOption:'FORMULA'});
  const after=full(check.data.values||[],count,t.width);
  const verified=digest(src)===digest(after);
  return res.status(verified?200:409).json({verified,sheet:body.sheet,start,count,changedRows:n,sourceHash,targetHash:digest(after),errorCode:verified?undefined:'READBACK_MISMATCH'});
 }catch(e){console.error('master-sheet sync',{status:e.response?.status||e.code||'ERROR'});return res.status(503).json({errorCode:'SYNC_UNAVAILABLE',code:e.response?.status||e.code||'UNKNOWN'});}
}
