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
  const size=req.body?.size??100;
  if(!Number.isInteger(size)||size<1||size>500)return res.status(400).json({error:'Invalid batch size'});
  const end=Math.min(start+size-1,sheet.rows);
  const rows=await page(s,sheet,start,end);
  return await withOracle(async db=>{
   const binds=rows.map((row,i)=>({
    p_snap_day:snapshot,
    p_sheet_key:sheet.id,
    p_sheet_title:sheet.name,
    p_row_index:start+i,
    p_col_count:sheet.cols,
    p_json_data:JSON.stringify(row),
    p_row_digest:digest(row)
   }));
   const mergeSql=`MERGE INTO ADMIN.DS_RAW_SHEET_ROWS t
    USING (SELECT :p_snap_day AS src_day,
                  :p_sheet_key AS src_sheet_key,
                  :p_row_index AS src_row_index,
                  :p_sheet_title AS src_title,
                  :p_col_count AS src_col_count,
                  :p_json_data AS src_json_data,
                  :p_row_digest AS src_digest FROM dual) src
    ON (t.SNAPSHOT_DAY=src.src_day AND t.SHEET_ID=src.src_sheet_key AND t.ROW_NUMBER=src.src_row_index)
    WHEN MATCHED THEN UPDATE SET t.SHEET_NAME=src.src_title,
                                 t.COLUMN_COUNT=src.src_col_count,
                                 t.RAW_JSON=src.src_json_data,
                                 t.ROW_SHA256=src.src_digest,
                                 t.ARCHIVED_AT=SYSTIMESTAMP
    WHEN NOT MATCHED THEN INSERT (SNAPSHOT_DAY,SHEET_ID,SHEET_NAME,ROW_NUMBER,COLUMN_COUNT,RAW_JSON,ROW_SHA256)
    VALUES (src.src_day,src.src_sheet_key,src.src_title,src.src_row_index,src.src_col_count,src.src_json_data,src.src_digest)`;
   await db.executeMany(mergeSql,binds,{bindDefs:{
    p_snap_day:{type:oracledb.STRING,maxSize:10},
    p_sheet_key:{type:oracledb.NUMBER},
    p_row_index:{type:oracledb.NUMBER},
    p_sheet_title:{type:oracledb.STRING,maxSize:1000},
    p_col_count:{type:oracledb.NUMBER},
    p_json_data:{type:oracledb.CLOB},
    p_row_digest:{type:oracledb.STRING,maxSize:64}
   }});
   await db.commit();return res.status(200).json({sheetId:sheet.id,start,end,count:rows.length});
  });
 }
 // Verify a bounded chunk so no Vercel request scans an entire large sheet.
 const start=req.body?.start;
 if(!Number.isInteger(start)||start<1||start>sheet.rows)return res.status(400).json({error:'Invalid start'});
 const size=req.body?.size??100;
  if(!Number.isInteger(size)||size<1||size>500)return res.status(400).json({error:'Invalid batch size'});
  const end=Math.min(start+size-1,sheet.rows);
 const storedOnly=req.body?.verification==='stored';
 if(req.body?.verification&& !['stored','source'].includes(req.body.verification))return res.status(400).json({error:'Invalid verification mode'});
 // Post-write verification must validate the immutable Oracle payload that was actually
 // committed. Reading a volatile Google Sheet again would compare different moments.
 const rows=storedOnly?null:await page(s,sheet,start,end);
 return await withOracle(async db=>{
  const stored=await db.execute(
   storedOnly
    ?'SELECT ROW_NUMBER,ROW_SHA256,RAW_JSON FROM ADMIN.DS_RAW_SHEET_ROWS WHERE SNAPSHOT_DAY=:p_verify_day AND SHEET_ID=:p_verify_sheet AND ROW_NUMBER BETWEEN :p_verify_first AND :p_verify_last ORDER BY ROW_NUMBER'
    :'SELECT ROW_NUMBER,ROW_SHA256 FROM ADMIN.DS_RAW_SHEET_ROWS WHERE SNAPSHOT_DAY=:p_verify_day AND SHEET_ID=:p_verify_sheet AND ROW_NUMBER BETWEEN :p_verify_first AND :p_verify_last ORDER BY ROW_NUMBER',
   {p_verify_day:snapshot,p_verify_sheet:sheet.id,p_verify_first:start,p_verify_last:end},
   {outFormat:oracledb.OUT_FORMAT_OBJECT,...(storedOnly?{fetchInfo:{RAW_JSON:{type:oracledb.STRING}}}:{})}
  );
  const expected=end-start+1;
  if(stored.rows.length!==expected)return res.status(409).json({verified:false,sheetId:sheet.id,start,end,error:'COUNT_MISMATCH',expected,stored:stored.rows.length});
  for(let i=0;i<expected;i++){
   const entry=stored.rows[i];
   if(entry.ROW_NUMBER!==start+i)return res.status(409).json({verified:false,sheetId:sheet.id,row:start+i,error:'ROW_POSITION_MISMATCH'});
   let expectedHash;
   try{expectedHash=storedOnly?digest(JSON.parse(entry.RAW_JSON)):digest(rows[i])}
   catch{return res.status(409).json({verified:false,sheetId:sheet.id,row:start+i,error:'INVALID_STORED_JSON'})}
   if(entry.ROW_SHA256!==expectedHash)return res.status(409).json({verified:false,sheetId:sheet.id,row:start+i,error:storedOnly?'STORED_PAYLOAD_HASH_MISMATCH':'HASH_MISMATCH_OR_SOURCE_CHANGED'});
  }
  return res.status(200).json({verified:true,verification:storedOnly?'stored':'source',sheetId:sheet.id,name:sheet.name,start,end,rows:expected,day:snapshot});
 });;
 }catch(e){console.error('Raw Oracle snapshot',e.code||e.message);return res.status(503).json({errorCode:e.code||'RAW_ARCHIVE_FAILED'})}
}
