import {timingSafeEqual,createHash} from 'node:crypto';
import {sheets,ID} from '../lib/_sheets.js';
import oracledb from 'oracledb';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const auth=req=>{const a=Buffer.from(String(req.headers.authorization||'').replace(/^Bearer /,'')),b=Buffer.from(process.env.ADMIN_ACCESS_TOKEN||'');return !!b.length&&a.length===b.length&&timingSafeEqual(a,b)};
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const quote=s=>"'"+s.replace(/'/g,"''")+"'";
const column=n=>{let out='';while(n>0){n--;out=String.fromCharCode(65+n%26)+out;n=Math.floor(n/26)}return out};
const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Sofia',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
async function withOracle(fn){
 let dir,db;try{dir=await mkdtemp(join(tmpdir(),'deepstats-raw-'));await writeFile(join(dir,'ewallet.pem'),process.env.ORACLE_WALLET_PEM,{mode:0o600});
 db=await oracledb.getConnection({user:process.env.ORACLE_USER,password:process.env.ORACLE_PASSWORD,connectString:process.env.ORACLE_CONNECT_STRING,walletLocation:dir,walletPassword:process.env.ORACLE_WALLET_PASSWORD});return await fn(db)}
 finally{if(db)await db.close().catch(()=>{});if(dir)await rm(dir,{recursive:true,force:true}).catch(()=>{})}
}
async function ensure(db){
 try{await db.execute(`CREATE TABLE ADMIN.DS_RAW_SHEET_ROWS (
 SNAPSHOT_DAY VARCHAR2(10) NOT NULL, SHEET_ID NUMBER NOT NULL, SHEET_NAME NVARCHAR2(250) NOT NULL,
 ROW_NUMBER NUMBER NOT NULL, COLUMN_COUNT NUMBER NOT NULL, RAW_JSON CLOB NOT NULL,
 ROW_SHA256 VARCHAR2(64) NOT NULL, ARCHIVED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
 CONSTRAINT DS_RAW_SHEET_ROWS_PK PRIMARY KEY (SNAPSHOT_DAY,SHEET_ID,ROW_NUMBER))`);await db.commit()}
 catch(e){if(e.errorNum!==955)throw e}
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
 const action=req.method==='GET'?'manifest':req.body?.action;
 if(!['manifest','batch','verify'].includes(action))return res.status(400).json({error:'Invalid action'});
 let s;try{s=await sheets();const sheetsInfo=await metadata(s);
 if(action==='manifest')return res.status(200).json({day:day(),spreadsheetId:ID,sheets:sheetsInfo});
 const snapshot=String(req.body?.day||'');
 if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(snapshot)||snapshot!==day())return res.status(400).json({error:'Snapshot must be today (Sofia)'});
 const sheet=sheetsInfo.find(x=>x.id===req.body?.sheetId);
 if(!sheet)return res.status(400).json({error:'Unknown sheet'});
 if(action==='batch'){
  const start=req.body?.start;
  if(!Number.isInteger(start)||start<1||start>sheet.rows)return res.status(400).json({error:'Invalid start'});
  const end=Math.min(start+99,sheet.rows);
  const rows=await page(s,sheet,start,end);
  return await withOracle(async db=>{
   await ensure(db);
   const binds=rows.map((row,i)=>{const payload=JSON.stringify(row);return {day:snapshot,id:sheet.id,name:sheet.name,row:start+i,cols:sheet.cols,raw:payload,hash:digest(row)}});
   await db.executeMany(`MERGE INTO ADMIN.DS_RAW_SHEET_ROWS t USING (SELECT :day d,:id i,:row r FROM dual) v
    ON (t.SNAPSHOT_DAY=v.d AND t.SHEET_ID=v.i AND t.ROW_NUMBER=v.r)
    WHEN MATCHED THEN UPDATE SET SHEET_NAME=:name,COLUMN_COUNT=:cols,RAW_JSON=:raw,ROW_SHA256=:hash,ARCHIVED_AT=SYSTIMESTAMP
    WHEN NOT MATCHED THEN INSERT (SNAPSHOT_DAY,SHEET_ID,SHEET_NAME,ROW_NUMBER,COLUMN_COUNT,RAW_JSON,ROW_SHA256)
    VALUES (:day,:id,:name,:row,:cols,:raw,:hash)`,binds,{bindDefs:{day:{type:oracledb.STRING,maxSize:10},id:{type:oracledb.NUMBER},row:{type:oracledb.NUMBER},name:{type:oracledb.STRING,maxSize:1000},cols:{type:oracledb.NUMBER},raw:{type:oracledb.CLOB},hash:{type:oracledb.STRING,maxSize:64}}});
   await db.commit();return res.status(200).json({sheetId:sheet.id,start,end,count:rows.length});
  });
 }
 // Re-read the complete source and compare EVERY row's hash to the Oracle snapshot.
 return await withOracle(async db=>{
  await ensure(db);
  const stored=await db.execute('SELECT ROW_NUMBER,ROW_SHA256 FROM ADMIN.DS_RAW_SHEET_ROWS WHERE SNAPSHOT_DAY=:day AND SHEET_ID=:id ORDER BY ROW_NUMBER',{day:snapshot,id:sheet.id},{outFormat:oracledb.OUT_FORMAT_OBJECT});
  if(stored.rows.length!==sheet.rows)return res.status(409).json({verified:false,sheetId:sheet.id,expected:sheet.rows,stored:stored.rows.length,error:'COUNT_MISMATCH'});
  const byRow=new Map(stored.rows.map(x=>[x.ROW_NUMBER,x.ROW_SHA256]));
  for(let start=1;start<=sheet.rows;start+=100){
   const rows=await page(s,sheet,start,Math.min(start+99,sheet.rows));
   for(let i=0;i<rows.length;i++)if(byRow.get(start+i)!==digest(rows[i]))return res.status(409).json({verified:false,sheetId:sheet.id,row:start+i,error:'HASH_MISMATCH_OR_SOURCE_CHANGED'});
  }
  return res.status(200).json({verified:true,sheetId:sheet.id,name:sheet.name,rows:sheet.rows,day:snapshot});
 });
 }catch(e){console.error('Raw Oracle snapshot',e.code||e.message);return res.status(503).json({errorCode:e.code||'RAW_ARCHIVE_FAILED'})}
}
