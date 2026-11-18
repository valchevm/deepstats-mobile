import {timingSafeEqual,createHash} from 'node:crypto';
import {sheets,ID} from './_sheets.js';
import oracledb from 'oracledb';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const auth=req=>{const a=Buffer.from(String(req.headers.authorization||'').replace(/^Bearer /,'')),b=Buffer.from(process.env.ADMIN_ACCESS_TOKEN||'');return !!b.length&&a.length===b.length&&timingSafeEqual(a,b)};
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const quote=s=>"'"+s.replace(/'/g,"''")+"'";
const column=n=>{let out='';while(n>0){n--;out=String.fromCharCode(65+n%26)+out;n=Math.floor(n/26)}return out};
const day=()=>{const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Sofia',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const value=Object.fromEntries(parts.filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));return `${value.year}-${value.month}-${value.day}`};
async function withOracle(fn){
 let dir,db;try{dir=await mkdtemp(join(tmpdir(),'deepstats-raw-'));await writeFile(join(dir,'ewallet.pem'),process.env.ORACLE_WALLET_PEM,{mode:0o600});
 db=await oracledb.getConnection({user:process.env.ORACLE_USER,password:process.env.ORACLE_PASSWORD,connectString:process.env.ORACLE_CONNECT_STRING,walletLocation:dir,walletPassword:process.env.ORACLE_WALLET_PASSWORD});return await fn(db)}
 finally{if(db)await db.close().catch(()=>{});if(dir)await rm(dir,{recursive:true,force:true}).catch(()=>{})}
}
async function preflight(db){
 // This service deliberately never requests CREATE TABLE or admin privileges.
 // DML privilege checks affect zero rows and leave existing data unchanged.
 try{
  await db.execute('SELECT SNAPSHOT_DAY,SHEET_ID,SHEET_NAME,ROW_NUMBER,COLUMN_COUNT,RAW_JSON,ROW_SHA256 FROM ADMIN.DS_RAW_SHEET_ROWS WHERE 1=0');
  await db.execute("INSERT INTO ADMIN.DS_RAW_SHEET_ROWS (SNAPSHOT_DAY,SHEET_ID,SHEET_NAME,ROW_NUMBER,COLUMN_COUNT,RAW_JSON,ROW_SHA256) SELECT '0000-00-00',-1,'probe',-1,1,TO_CLOB('{}'),'0' FROM dual WHERE 1=0");
  await db.execute('UPDATE ADMIN.DS_RAW_SHEET_ROWS SET ROW_SHA256=ROW_SHA256 WHERE 1=0');
  await db.rollback();
 }catch(e){
  await db.rollback().catch(()=>{});
  if(e.errorNum===942||e.errorNum===1031)throw Object.assign(new Error('Archive table missing or inaccessible. Run sql/oracle-raw-snapshot.sql once as ADMIN and grant specific privileges.'),{code:'ARCHIVE_SCHEMA_SETUP_REQUIRED'});
  throw e;
 }
}
async function metadata(s){const r=await s.spreadsheets.get({spreadsheetId:ID,fields:'spreadsheetId,properties(title),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))'});return r.data.sheets.map(x=>({id:x.properties.sheetId,name:x.properties.title,rows:x.properties.gridProperties.rowCount,cols:x.properties.gridProperties.columnCount}))}
async function page(s,sh,start,end){
 const range=quote(sh.name)+'!A'+start+':'+column(sh.cols)+end;
 const requests=['FORMATTED_VALUE','UNFORMATTED_VALUE','FORMULA'].map(valueRenderOption=>s.spreadsheets.values.get({spreadsheetId:ID,range,valueRenderOption}));
 const result=await Promise.all(requests);
 return Array.from({length:end-start+1},(_,i)=>({formatted:result[0].data.values?.[i]||[],raw:result[1].data.values?.[i]||[],formulas:result[2].data.values?.[i]||[]}));
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
 if(!auth(req))return res.status(403).json({error:'Forbidden'});
 const action=req.method==='GET'?(req.query.kind==='raw-preflight'?'preflight':'manifest'):req.body?.action;
 if(!['manifest','preflight','batch','verify'].includes(action))return res.status(400).json({error:'Invalid action'});
 let s;try{s=await sheets();const sheetsInfo=await metadata(s);
 if(action==='manifest')return res.status(200).json({day:day(),spreadsheetId:ID,sheets:sheetsInfo});
 if(action==='preflight')return await withOracle(async db=>{await preflight(db);return res.status(200).json({ready:true,schema:'ADMIN.DS_RAW_SHEET_ROWS',sheets:sheetsInfo.length,day:day()})});
 const snapshot=String(req.body?.day||'');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(snapshot)||snapshot!==day())return res.status(400).json({error:'Snapshot must be today (Sofia)'});
 const sheet=sheetsInfo.find(x=>x.id===req.body?.sheetId);
 if(!sheet)return res.status(400).json({error:'Unknown sheet'});
 if(action==='batch'){
  const start=req.body?.start;
  if(!Number.isInteger(start)||start<1||start>sheet.rows)return res.status(400).json({error:'Invalid start'});
  const end=Math.min(start+99,sheet.rows);
  const rows=await page(s,sheet,start,end);
  return await withOracle(async db=>{
   await preflight(db);
   const binds=rows.map((row,i)=>{const payload=JSON.stringify(row);return {day:snapshot,id:sheet.id,name:sheet.name,rowNum:start+i,cols:sheet.cols,raw:payload,hash:digest(row)}});
   await db.executeMany(`MERGE INTO ADMIN.DS_RAW_SHEET_ROWS t
    USING (SELECT :day AS d,:id AS i,:rowNum AS r,:name AS n,:cols AS c,:raw AS j,:hash AS h FROM dual) v
    ON (t.SNAPSHOT_DAY=v.d AND t.SHEET_ID=v.i AND t.ROW_NUMBER=v.r)
    WHEN MATCHED THEN UPDATE SET t.SHEET_NAME=v.n,t.COLUMN_COUNT=v.c,t.RAW_JSON=v.j,t.ROW_SHA256=v.h,t.ARCHIVED_AT=SYSTIMESTAMP
    WHEN NOT MATCHED THEN INSERT (SNAPSHOT_DAY,SHEET_ID,SHEET_NAME,ROW_NUMBER,COLUMN_COUNT,RAW_JSON,ROW_SHA256)
    VALUES (v.d,v.i,v.n,v.r,v.c,v.j,v.h)`,binds,{bindDefs:{day:{type:oracledb.STRING,maxSize:10},id:{type:oracledb.NUMBER},rowNum:{type:oracledb.NUMBER},name:{type:oracledb.STRING,maxSize:1000},cols:{type:oracledb.NUMBER},raw:{type:oracledb.CLOB},hash:{type:oracledb.STRING,maxSize:64}}});
   await db.commit();return res.status(200).json({sheetId:sheet.id,start,end,count:rows.length});
  });
 }
 // Verify a bounded chunk so no Vercel request scans an entire large sheet.
 const start=req.body?.start;
 if(!Number.isInteger(start)||start<1||start>sheet.rows)return res.status(400).json({error:'Invalid start'});
 const end=Math.min(start+99,sheet.rows);
 const rows=await page(s,sheet,start,end);
 return await withOracle(async db=>{
  const stored=await db.execute('SELECT ROW_NUMBER,ROW_SHA256 FROM ADMIN.DS_RAW_SHEET_ROWS WHERE SNAPSHOT_DAY=:day AND SHEET_ID=:id AND ROW_NUMBER BETWEEN :startRow AND :endRow ORDER BY ROW_NUMBER',{day:snapshot,id:sheet.id,startRow:start,endRow:end},{outFormat:oracledb.OUT_FORMAT_OBJECT});
  if(stored.rows.length!==rows.length)return res.status(409).json({verified:false,sheetId:sheet.id,start,end,error:'COUNT_MISMATCH',expected:rows.length,stored:stored.rows.length});
  const byRow=new Map(stored.rows.map(x=>[x.ROW_NUMBER,x.ROW_SHA256]));
  for(let i=0;i<rows.length;i++)if(byRow.get(start+i)!==digest(rows[i]))return res.status(409).json({verified:false,sheetId:sheet.id,row:start+i,error:'HASH_MISMATCH_OR_SOURCE_CHANGED'});
  return res.status(200).json({verified:true,sheetId:sheet.id,name:sheet.name,start,end,rows:rows.length,day:snapshot});
 });
 }catch(e){console.error('Raw Oracle snapshot',e.code||e.message);return res.status(503).json({errorCode:e.code||'RAW_ARCHIVE_FAILED'})}
}
