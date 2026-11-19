// Internal handler: preserves existing API behavior; mounted via api/oracle-archive.js.
import {timingSafeEqual,createHash} from 'node:crypto';
import {sheets,read} from './_sheets.js';
import oracledb from 'oracledb';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function authorized(req) {
 const expected=process.env.ADMIN_ACCESS_TOKEN||'';
 const supplied=String(req.headers.authorization||'').replace(/^Bearer /,'');
 const a=Buffer.from(supplied),b=Buffer.from(expected);
 return !!expected&&!!supplied&&a.length===b.length&&timingSafeEqual(a,b);
}
function dateOf(v) {
 const m=String(v||'').trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
 if(!m)return null;
 const iso=`${m[3]}-${m[2]}-${m[1]}`;
 const d=new Date(iso+'T00:00:00Z');
 return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===iso?iso:null;
}
function number(v){const n=Number(String(v??'').replace(',','.'));return Number.isFinite(n)?n:null}
function status(v){const s=String(v||'').toLowerCase();return s==='печели'?'win':s==='губи'?'loss':s==='върнат'?'void':'pending'}
function hash(s){return createHash('sha256').update(s).digest('hex').slice(0,36)}
function rowsFrom(values,today){
 const out=[],bad=[];
 for(let i=1;i<values.length;i++){
  const r=values[i];if(!r?.[0]&&!r?.[3])continue;
  const day=dateOf(r[0]);
  if(!day||day>=today)continue;
  if(!r[3]||!r[4]){bad.push(i+1);continue}
  const matchId='best:'+hash(day+'|'+r[3]);
  const selectionId='best:'+hash(day+'|'+r[3]+'|'+r[5]+'|'+r[4]);
  const teams=String(r[3]).split(/\s+[–—-]\s+/);
  out.push({matchId,selectionId,day,league:String(r[2]||''),match:String(r[3]),home:teams[0]||'',away:teams[1]||'',selection:String(r[4]),odds:number(r[9]),level:String(r[10]||''),result:String(r[11]||''),status:status(r[11]),profit:status(r[11])==='win'&&number(r[9])!==null?number(r[9])-1:status(r[11])==='loss'?-1:status(r[11])==='void'?0:null,raw:JSON.stringify({source:'АРХИВ BEST',row:i+1,values:r.slice(0,14)})});
 }
 return {out,bad};
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
 if(!authorized(req))return res.status(403).json({error:'Forbidden'});
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Sofia',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 let values;
 try{values=await read(await sheets(),"'АРХИВ BEST'!A1:N20000")}catch(e){console.error('Archive source read',e.code||e.message);return res.status(503).json({errorCode:'SHEETS_READ_FAILED'})}
 const {out,bad}=rowsFrom(values,today);
 if(req.method==='GET')return res.status(200).json({mode:'preview',source:'АРХИВ BEST',historicalSelections:out.length,uniqueMatches:new Set(out.map(x=>x.matchId)).size,skippedIncomplete:bad.length,skippedRowNumbers:bad.slice(0,20),sourceUnchanged:true});
 if(req.body?.confirm!=='IMPORT_ARCHIVE_BEST')return res.status(400).json({error:'Confirmation required'});
 if(bad.length)return res.status(409).json({errorCode:'INCOMPLETE_SOURCE_ROWS',count:bad.length,rows:bad.slice(0,20)});
 if(!out.length)return res.status(200).json({imported:0,sourceUnchanged:true});
 let directory,connection;
 try{
  directory=await mkdtemp(join(tmpdir(),'deepstats-wallet-'));
  await writeFile(join(directory,'ewallet.pem'),process.env.ORACLE_WALLET_PEM,{mode:0o600});
  connection=await oracledb.getConnection({user:process.env.ORACLE_USER,password:process.env.ORACLE_PASSWORD,connectString:process.env.ORACLE_CONNECT_STRING,walletLocation:directory,walletPassword:process.env.ORACLE_WALLET_PASSWORD});
  const matches=[...new Map(out.map(x=>[x.matchId,x])).values()];
  for(const x of matches){
   await connection.execute(`MERGE INTO ADMIN.DS_MATCHES t USING (SELECT :id id FROM dual) s ON (t.MATCH_ID=s.id) WHEN NOT MATCHED THEN INSERT (MATCH_ID,MATCH_DATE,LEAGUE,HOME_TEAM,AWAY_TEAM,MATCH_LABEL) VALUES (:id2,TO_DATE(:day,'YYYY-MM-DD'),:league,:home,:away,:match)`,{id:x.matchId,id2:x.matchId,day:x.day,league:x.league,home:x.home,away:x.away,match:x.match});
  }
  for(const x of out){
   await connection.execute(`MERGE INTO ADMIN.DS_SELECTIONS t USING (SELECT :id id FROM dual) s ON (t.SELECTION_ID=s.id) WHEN MATCHED THEN UPDATE SET ODDS=:odds1,RESULT_LABEL=:result1,RESULT_STATUS=:status1,PROFIT_UNITS=:profit1,SOURCE_ROW_JSON=:raw1 WHEN NOT MATCHED THEN INSERT (SELECTION_ID,MATCH_ID,MATCH_DATE,SOURCE_TYPE,SELECTION_LABEL,ODDS,LEVEL_LABEL,RESULT_LABEL,RESULT_STATUS,PROFIT_UNITS,SOURCE_ROW_JSON) VALUES (:id2,:matchId,TO_DATE(:day,'YYYY-MM-DD'),'BEST',:selection,:odds2,:levelLabel,:result2,:status2,:profit2,:raw2)`,{id:x.selectionId,id2:x.selectionId,matchId:x.matchId,day:x.day,selection:x.selection,odds1:x.odds,odds2:x.odds,levelLabel:x.level,result1:x.result,result2:x.result,status1:x.status,status2:x.status,profit1:x.profit,profit2:x.profit,raw1:x.raw,raw2:x.raw});
  }
  await connection.commit();
  return res.status(200).json({importedSelections:out.length,importedMatches:matches.length,sourceUnchanged:true});
 }catch(e){if(connection)try{await connection.rollback()}catch{}console.error('Archive import',e.code||'IMPORT_FAILED');return res.status(503).json({errorCode:e.code||'IMPORT_FAILED',sourceUnchanged:true})}
 finally{if(connection)try{await connection.close()}catch{}if(directory)try{await rm(directory,{recursive:true,force:true})}catch{}}
}
