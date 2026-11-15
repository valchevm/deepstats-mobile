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
function dateOf(v){
 const m=String(v||'').trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
 if(!m)return null;
 const iso=`${m[3]}-${m[2]}-${m[1]}`;
 const d=new Date(iso+'T00:00:00Z');
 return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===iso?iso:null;
}
const hash=v=>createHash('sha256').update(v).digest('hex').slice(0,36);
const num=v=>{const n=Number(String(v??'').replace(',','.'));return Number.isFinite(n)?n:null};
function status(v){
 const s=String(v||'').trim().toLowerCase();
 if(/печели|спечелен|win/.test(s))return 'win';
 if(/губи|загуб|loss/.test(s))return 'loss';
 if(/върнат|void|push/.test(s))return 'void';
 return 'pending';
}
function parse(values,today){
 const records=[],invalid=[];
 for(let i=0;i<values.length;i++){
  const r=values[i],day=dateOf(r?.[0]);
  if(!day||day>=today)continue;
  if(!String(r[3]||'').trim()||!String(r[4]||'').trim()){invalid.push(i+11);continue}
  const match=String(r[3]).trim(),selection=String(r[4]).trim();
  const matchId='full:'+hash(day+'|'+match);
  const id='full:'+hash([day,match,selection,String(r[5]||''),i+11].join('|'));
  const teams=match.split(/\s+[–—-]\s+/);
  const odds=num(r[9]),result=String(r[11]||''),st=status(result);
  records.push({id,matchId,day,match,home:teams[0]||'',away:teams[1]||'',league:String(r[2]||''),selection,odds,level:String(r[10]||''),result,status:st,profit:st==='win'&&odds!==null?odds-1:st==='loss'?-1:st==='void'?0:null,raw:JSON.stringify({source:'СЕЛЕКЦИИ',row:i+11,values:r.slice(0,15)})});
 }
 return {records,invalid};
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
 if(!authorized(req))return res.status(403).json({error:'Forbidden'});
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Sofia',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 let values;
 try{values=await read(await sheets(),"'СЕЛЕКЦИИ'!A11:O25000")}
 catch(e){console.error('Full archive source',e.code||'READ_FAILED');return res.status(503).json({errorCode:'SHEETS_READ_FAILED'})}
 const {records,invalid}=parse(values,today);
 const uniqueMatches=new Set(records.map(x=>x.matchId)).size;
 if(req.method==='GET')return res.status(200).json({source:'СЕЛЕКЦИИ',historicalSelections:records.length,uniqueMatches,invalidRows:invalid.length,invalidRowNumbers:invalid.slice(0,20),sourceUnchanged:true});
 if(req.body?.confirm!=='IMPORT_FULL_SELECTIONS')return res.status(400).json({error:'Confirmation required'});
 const offset=req.body?.offset;
 if(!Number.isInteger(offset)||offset<0||offset>=records.length)return res.status(400).json({error:'Invalid offset'});
 if(invalid.length)return res.status(409).json({errorCode:'INVALID_SOURCE_ROWS',invalidRows:invalid.length,invalidRowNumbers:invalid.slice(0,20)});
 const batch=records.slice(offset,offset+20);
 let directory,connection;
 try{
  directory=await mkdtemp(join(tmpdir(),'deepstats-wallet-'));
  await writeFile(join(directory,'ewallet.pem'),process.env.ORACLE_WALLET_PEM,{mode:0o600});
  connection=await oracledb.getConnection({user:process.env.ORACLE_USER,password:process.env.ORACLE_PASSWORD,connectString:process.env.ORACLE_CONNECT_STRING,walletLocation:directory,walletPassword:process.env.ORACLE_WALLET_PASSWORD});
  const unique=[...new Map(batch.map(x=>[x.matchId,x])).values()];
  for(const x of unique)await connection.execute(`MERGE INTO ADMIN.DS_MATCHES t USING (SELECT :id k FROM dual) s ON (t.MATCH_ID=s.k) WHEN NOT MATCHED THEN INSERT (MATCH_ID,MATCH_DATE,LEAGUE,HOME_TEAM,AWAY_TEAM,MATCH_LABEL) VALUES (:id2,TO_DATE(:day,'YYYY-MM-DD'),:league,:home,:away,:match)`,{id:x.matchId,id2:x.matchId,day:x.day,league:x.league,home:x.home,away:x.away,match:x.match});
  for(const x of batch)await connection.execute(`MERGE INTO ADMIN.DS_SELECTIONS t USING (SELECT :id k FROM dual) s ON (t.SELECTION_ID=s.k) WHEN MATCHED THEN UPDATE SET ODDS=:odds1,RESULT_LABEL=:result1,RESULT_STATUS=:status1,PROFIT_UNITS=:profit1,SOURCE_ROW_JSON=:raw1 WHEN NOT MATCHED THEN INSERT (SELECTION_ID,MATCH_ID,MATCH_DATE,SOURCE_TYPE,SELECTION_LABEL,ODDS,LEVEL_LABEL,RESULT_LABEL,RESULT_STATUS,PROFIT_UNITS,SOURCE_ROW_JSON) VALUES (:id2,:matchId,TO_DATE(:day,'YYYY-MM-DD'),'FULL',:selection,:odds2,:level,:result2,:status2,:profit2,:raw2)`,{id:x.id,id2:x.id,matchId:x.matchId,day:x.day,selection:x.selection,odds1:x.odds,odds2:x.odds,level:x.level,result1:x.result,result2:x.result,status1:x.status,status2:x.status,profit1:x.profit,profit2:x.profit,raw1:x.raw,raw2:x.raw});
  await connection.commit();
  return res.status(200).json({processed:batch.length,nextOffset:offset+batch.length,expected:records.length,sourceUnchanged:true});
 }catch(e){if(connection)try{await connection.rollback()}catch{}console.error('Full archive import',e.code||'IMPORT_FAILED');return res.status(503).json({errorCode:e.code||'IMPORT_FAILED'})}
 finally{if(connection)try{await connection.close()}catch{}if(directory)try{await rm(directory,{recursive:true,force:true})}catch{}}
}
