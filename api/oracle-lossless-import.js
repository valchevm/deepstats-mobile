// Lossless original-workbook migration. Admin-only, read-only Sheets, append/upsert Oracle.
// NEVER delete or modify source Sheets, normalized Oracle tables, or working Sheets.
import {google} from 'googleapis';
import {createHash, timingSafeEqual} from 'node:crypto';
import oracledb from 'oracledb';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const SOURCE_ID='1iEufNQy8doCcfPA0LkHxPLvvXKiRKc60rH2dtyVx_oo';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const nonEmpty=v=>v!==null&&v!==undefined&&String(v)!=='';
const rowHasValues=row=>Array.isArray(row)&&row.some(nonEmpty);
const quoted=s=>"'"+s.replace(/'/g,"''")+"'";
const column=n=>{let result='';while(n>0){n--;result=String.fromCharCode(65+n%26)+result;n=Math.floor(n/26)}return result};
function sofiaDay(){
 const p=new Intl.DateTimeFormat('en-GB',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Europe/Sofia'}).formatToParts(new Date());
 const x=Object.fromEntries(p.filter(a=>a.type!=='literal').map(a=>[a.type,a.value]));
 return x.year+'-'+x.month+'-'+x.day;
}
function authorized(req){
 const token=process.env.ADMIN_ACCESS_TOKEN||'';
 const got=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
 const a=Buffer.from(token),b=Buffer.from(got);
 return !!token&&!!got&&a.length===b.length&&timingSafeEqual(a,b);
}
async function client(){
 const email=process.env.GOOGLE_CLIENT_EMAIL;
 const key=process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g,'\n');
 if(!email||!key)throw Object.assign(Error('Google configuration missing'),{code:'GOOGLE_CONFIGURATION_MISSING'});
 const auth=new google.auth.JWT({email,key,scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});
 return google.sheets({version:'v4',auth});
}
async function tabs(api){
 const result=await api.spreadsheets.get({spreadsheetId:SOURCE_ID,fields:'spreadsheetId,sheets(properties(title,sheetId,gridProperties(rowCount,columnCount)))'});
 return (result.data.sheets||[]).map(x=>({name:x.properties.title,id:x.properties.sheetId,rows:x.properties.gridProperties.rowCount,cols:x.properties.gridProperties.columnCount}));
}
function renderOptions(){return ['FORMATTED_VALUE','UNFORMATTED_VALUE','FORMULA']}
async function readModes(api,tab,start,end){
 const range=quoted(tab.name)+'!A'+start+':'+column(tab.cols)+end;
 const values=await Promise.all(renderOptions().map(valueRenderOption=>api.spreadsheets.values.get({spreadsheetId:SOURCE_ID,range,valueRenderOption})));
 return values.map(x=>x.data.values||[]);
}
function prepare(modes,start,count){
 const [formatted,raw,formulas]=modes;
 const result=[];
 for(let i=0;i<count;i++){
  const payload={formatted:formatted[i]||[],raw:raw[i]||[],formulas:formulas[i]||[]};
  if(Object.values(payload).some(rowHasValues))result.push({row:start+i,payload,sha:digest(payload)});
 }
 return result;
}
function manifest(modes,tab){
 const count=Math.max(...modes.map(x=>x.length),0);
 const rows=prepare(modes,1,count);
 return {name:tab.name,sheetId:tab.id,columns:tab.cols,capacity:tab.rows,lastUsed:rows.length?rows[rows.length-1].row:0,nonEmptyRows:rows.length,fingerprint:digest(modes)};
}
async function withOracle(work){
 let directory,db;
 try{
  directory=await mkdtemp(join(tmpdir(),'ds-migration-'));
  if(!process.env.ORACLE_WALLET_PEM)throw Object.assign(Error('Oracle wallet missing'),{code:'ORACLE_CONFIGURATION_MISSING'});
  await writeFile(join(directory,'ewallet.pem'),process.env.ORACLE_WALLET_PEM,{mode:0o600});
  db=await oracledb.getConnection({user:process.env.ORACLE_USER,password:process.env.ORACLE_PASSWORD,connectString:process.env.ORACLE_CONNECT_STRING,walletLocation:directory,walletPassword:process.env.ORACLE_WALLET_PASSWORD});
  return await work(db);
 }finally{
  if(db)await db.close().catch(()=>{});
  if(directory)await rm(directory,{recursive:true,force:true}).catch(()=>{});
 }
}
const sql=[
 'MERGE INTO ADMIN.DS_RAW_SHEET_ROWS target',
 'USING (SELECT :p_day AS d,:p_sheet AS s,:p_row AS r,:p_name AS n,:p_cols AS c,:p_json AS j,:p_hash AS h FROM dual) src',
 'ON (target.SNAPSHOT_DAY=src.d AND target.SHEET_ID=src.s AND target.ROW_NUMBER=src.r)',
 'WHEN MATCHED THEN UPDATE SET target.SHEET_NAME=src.n,target.COLUMN_COUNT=src.c,target.RAW_JSON=src.j,target.ROW_SHA256=src.h,target.ARCHIVED_AT=SYSTIMESTAMP',
 'WHERE target.ROW_SHA256<>src.h',
 'WHEN NOT MATCHED THEN INSERT (SNAPSHOT_DAY,SHEET_ID,SHEET_NAME,ROW_NUMBER,COLUMN_COUNT,RAW_JSON,ROW_SHA256)',
 'VALUES (src.d,src.s,src.n,src.r,src.c,src.j,src.h)'
].join(' ');
function valuesEqual(a,b){return a===b}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(!authorized(req))return res.status(403).json({error:'Forbidden'});
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
 const mode=req.method==='GET'?String(req.query.mode||'preflight'):String(req.body?.mode||'');
 if(!['preflight','manifest','batch'].includes(mode)||mode==='batch'&&req.method!=='POST'||mode!=='batch'&&req.method!=='GET')return res.status(400).json({error:'Invalid mode'});
 try{
  const api=await client();
  const available=await tabs(api);
  if(mode==='preflight'){
   const required=['СЕЛЕКЦИИ','АРХИВ BEST','МАЧОВЕ JSON','СТРАТЕГИИ_ДАННИ','ДАННИ','СТРАТЕГИИ','БЕТА СТРАТЕГИИ'];
   if(required.some(name=>!available.some(tab=>tab.name===name)))return res.status(409).json({error:'Missing source tab'});
   await withOracle(async db=>{
    await db.execute('SELECT SNAPSHOT_DAY,SHEET_ID,ROW_NUMBER,ROW_SHA256 FROM ADMIN.DS_RAW_SHEET_ROWS WHERE 1=0');
    await db.execute("UPDATE ADMIN.DS_RAW_SHEET_ROWS SET ROW_SHA256=ROW_SHA256 WHERE 1=0");
    await db.rollback();
   });
   return res.status(200).json({ready:true,day:sofiaDay(),source:SOURCE_ID,tabs:available,storage:'ADMIN.DS_RAW_SHEET_ROWS',readOnlySource:true});
  }
  const name=String(mode==='manifest'?req.query.tab:req.body?.tab||'');
  const tab=available.find(x=>x.name===name);
  if(!tab)return res.status(400).json({error:'Unrecognized source sheet'});
  if(mode==='manifest'){
   const start=Number(req.query.start),size=Number(req.query.size||250);
   if(!Number.isInteger(start)||start<1||start>tab.rows||!Number.isInteger(size)||size<1||size>250)return res.status(400).json({error:'Invalid manifest range'});
   const end=Math.min(start+size-1,tab.rows);
   const rows=prepare(await readModes(api,tab,start,end),start,end-start+1);
   return res.status(200).json({day:sofiaDay(),name:tab.name,sheetId:tab.id,start,end,columns:tab.cols,nonEmptyRows:rows.length,lastUsed:rows.length?rows[rows.length-1].row:0,fingerprint:digest(rows.map(x=>[x.row,x.sha]))});
  }
  const start=req.body?.start,size=req.body?.size,day=req.body?.day;
  if(day!==sofiaDay())return res.status(409).json({error:'Date changed; restart snapshot'});
  if(req.body?.confirm!=='MIGRATE_LOSSLESS_ORIGINAL')return res.status(400).json({error:'Explicit migration confirmation required'});
  if(!Number.isInteger(start)||start<1||start>tab.rows||!Number.isInteger(size)||size<1||size>100)return res.status(400).json({error:'Invalid row batch'});
  const end=Math.min(start+size-1,tab.rows);
  const rows=prepare(await readModes(api,tab,start,end),start,end-start+1);
  if(!rows.length)return res.status(200).json({verified:true,day,tab:name,start,end,nonEmpty:0,sourceUnchanged:true});
  return await withOracle(async db=>{
   try{
    const binds=rows.map(x=>({p_day:day,p_sheet:tab.id,p_row:x.row,p_name:tab.name,p_cols:tab.cols,p_json:JSON.stringify(x.payload),p_hash:x.sha}));
    await db.executeMany(sql,binds,{bindDefs:{
     p_day:{type:oracledb.STRING,maxSize:10},p_sheet:{type:oracledb.NUMBER},p_row:{type:oracledb.NUMBER},
     p_name:{type:oracledb.STRING,maxSize:1000},p_cols:{type:oracledb.NUMBER},
     p_json:{type:oracledb.CLOB},p_hash:{type:oracledb.STRING,maxSize:64}
    }});
    await db.commit();
    const saved=await db.execute(
     'SELECT ROW_NUMBER, ROW_SHA256 FROM ADMIN.DS_RAW_SHEET_ROWS WHERE SNAPSHOT_DAY=:d AND SHEET_ID=:s AND ROW_NUMBER BETWEEN :f AND :l',
     {d:day,s:tab.id,f:start,l:end},{outFormat:oracledb.OUT_FORMAT_OBJECT}
    );
    const indexed=new Map(saved.rows.map(x=>[Number(x.ROW_NUMBER),x.ROW_SHA256]));
    const unverified=rows.filter(x=>!valuesEqual(indexed.get(x.row),x.sha));
    if(unverified.length)return res.status(409).json({verified:false,error:'ORACLE_HASH_MISMATCH',tab:name,start,end,firstUnverified:unverified[0].row});
    return res.status(200).json({verified:true,day,tab:name,start,end,nonEmpty:rows.length,sourceUnchanged:true});
   }catch(e){await db.rollback().catch(()=>{});throw e}
  });
 }catch(e){
  console.error('Lossless source migration',e.code||e.response?.status||'MIGRATION_FAILED');
  return res.status(503).json({errorCode:e.code||'MIGRATION_FAILED'});
 }
}
