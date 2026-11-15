import {timingSafeEqual,createHash} from 'node:crypto';
import {sheets,read} from './_sheets.js';
import oracledb from 'oracledb';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function authorized(req){
 const expected=process.env.ADMIN_ACCESS_TOKEN||'';
 const supplied=String(req.headers.authorization||'').replace(/^Bearer /,'');
 const a=Buffer.from(supplied),b=Buffer.from(expected);
 return !!expected&&!!supplied&&a.length===b.length&&timingSafeEqual(a,b);
}
function day(v){
 const m=String(v||'').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
 if(!m)return null;
 const iso=`${m[3]}-${m[2]}-${m[1]}`;
 const d=new Date(iso+'T00:00:00Z');
 return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===iso?iso:null;
}
function digest(v){return createHash('sha256').update(v).digest('hex').slice(0,40)}
function parse(values,today){
 const records=[],invalid=[];
 for(let i=1;i<values.length;i++){
  const r=values[i];if(!r?.some(x=>String(x||'').trim()))continue;
  const observed=day(r[0]),matchDay=day(r[1]);
  if(!matchDay||matchDay>=today)continue;
  const odds=Number(String(r[9]||'').replace(',','.'));
  if(!observed||!r[5]||!r[6]||!Number.isFinite(odds)||odds<=1){invalid.push(i+1);continue}
  // Source row included: identical prices on different rows are retained, reruns remain idempotent.
  const id='legacy:'+digest([i+1,observed,matchDay,r[5],r[6],odds].join('|'));
  records.push({id,observed,matchDay,match:String(r[5]),league:String(r[4]||''),kickoff:String(r[3]||''),selection:String(r[6]),odds,confidence:String(r[10]||''),sourceId:String(r[11]||''),sourceRow:i+1});
 }
 return {records,invalid};
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
 if(!authorized(req))return res.status(403).json({error:'Forbidden'});
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Sofia',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 let values;
 try{values=await read(await sheets(),"'ИСТОРИЯ КОЕФ.'!A1:L7000")}
 catch(e){console.error('Legacy odds source read',e.code||'READ_FAILED');return res.status(503).json({errorCode:'SHEETS_READ_FAILED'})}
 const {records,invalid}=parse(values,today);
 if(req.method==='GET')return res.status(200).json({mode:'preview',source:'ИСТОРИЯ КОЕФ.',historicalObservations:records.length,invalidRows:invalid.length,invalidRowNumbers:invalid.slice(0,20),timestampPrecision:'date-only',sourceUnchanged:true});
 if(req.body?.confirm!=='IMPORT_LEGACY_ODDS')return res.status(400).json({error:'Confirmation required'});
 if(invalid.length)return res.status(409).json({errorCode:'INVALID_SOURCE_ROWS',invalidRows:invalid.length,invalidRowNumbers:invalid.slice(0,20)});
 let directory,connection;
 try{
  directory=await mkdtemp(join(tmpdir(),'deepstats-wallet-'));
  await writeFile(join(directory,'ewallet.pem'),process.env.ORACLE_WALLET_PEM,{mode:0o600});
  connection=await oracledb.getConnection({user:process.env.ORACLE_USER,password:process.env.ORACLE_PASSWORD,connectString:process.env.ORACLE_CONNECT_STRING,walletLocation:directory,walletPassword:process.env.ORACLE_WALLET_PASSWORD});
  for(const x of records){
   await connection.execute(`MERGE INTO ADMIN.DS_ODDS_DAILY_LEGACY t USING (SELECT :obsId k FROM dual) s ON (t.OBSERVATION_ID=s.k) WHEN NOT MATCHED THEN INSERT (OBSERVATION_ID,OBSERVED_DATE,MATCH_DATE,MATCH_LABEL,LEAGUE,KICKOFF_LOCAL,SELECTION_LABEL,DECIMAL_ODDS,CONFIDENCE_LABEL,SOURCE_SELECTION_ID,SOURCE_ROW) VALUES (:obsId2,TO_DATE(:observed,'YYYY-MM-DD'),TO_DATE(:matchDay,'YYYY-MM-DD'),:matchLabel,:league,:kickoff,:selectionLabel,:odds,:confidence,:sourceId,:sourceRow)`,{obsId:x.id,obsId2:x.id,observed:x.observed,matchDay:x.matchDay,matchLabel:x.match,league:x.league,kickoff:x.kickoff,selectionLabel:x.selection,odds:x.odds,confidence:x.confidence,sourceId:x.sourceId,sourceRow:x.sourceRow});
  }
  const count=await connection.execute('SELECT COUNT(*) FROM ADMIN.DS_ODDS_DAILY_LEGACY');
  await connection.commit();
  return res.status(200).json({processed:records.length,totalStored:Number(count.rows?.[0]?.[0]||0),timestampPrecision:'date-only',sourceUnchanged:true});
 }catch(e){if(connection)try{await connection.rollback()}catch{}console.error('Legacy odds import',e.code||'IMPORT_FAILED');return res.status(503).json({errorCode:e.code||'IMPORT_FAILED',sourceUnchanged:true})}
 finally{if(connection)try{await connection.close()}catch{}if(directory)try{await rm(directory,{recursive:true,force:true})}catch{}}
}
