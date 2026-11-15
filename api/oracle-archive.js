import {timingSafeEqual} from 'node:crypto';
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
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(String(v||''))}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 if(!authorized(req))return res.status(403).json({error:'Forbidden'});
 const kind=String(req.query.kind||'summary');
 if(!['summary','matches','selections','odds'].includes(kind))return res.status(400).json({error:'Invalid kind'});
 const limit=Number(req.query.limit??50),offset=Number(req.query.offset??0);
 if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0||offset>1000000)return res.status(400).json({error:'Invalid pagination'});
 const from=req.query.from,to=req.query.to;
 if((from&&!validDate(from))||(to&&!validDate(to)))return res.status(400).json({error:'Dates must be YYYY-MM-DD'});
 let directory,connection;
 try{
  directory=await mkdtemp(join(tmpdir(),'deepstats-wallet-'));
  await writeFile(join(directory,'ewallet.pem'),process.env.ORACLE_WALLET_PEM,{mode:0o600});
  connection=await oracledb.getConnection({user:process.env.ORACLE_USER,password:process.env.ORACLE_PASSWORD,connectString:process.env.ORACLE_CONNECT_STRING,walletLocation:directory,walletPassword:process.env.ORACLE_WALLET_PASSWORD});
  const opts={outFormat:oracledb.OUT_FORMAT_OBJECT};
  if(kind==='summary'){
   const [m,s,o]=await Promise.all([
    connection.execute('SELECT COUNT(*) AS TOTAL FROM ADMIN.DS_MATCHES',[],opts),
    connection.execute('SELECT COUNT(*) AS TOTAL FROM ADMIN.DS_SELECTIONS',[],opts),
    connection.execute('SELECT COUNT(*) AS TOTAL FROM ADMIN.DS_ODDS_DAILY_LEGACY',[],opts)
   ]);
   const breakdown=await connection.execute(`SELECT SOURCE_TYPE, COUNT(*) AS TOTAL, COUNT(DISTINCT MATCH_ID) AS MATCHES, SUM(CASE WHEN RESULT_STATUS='win' THEN 1 ELSE 0 END) AS WINS, SUM(CASE WHEN RESULT_STATUS='loss' THEN 1 ELSE 0 END) AS LOSSES, SUM(CASE WHEN RESULT_STATUS='void' THEN 1 ELSE 0 END) AS VOIDS, SUM(CASE WHEN RESULT_STATUS='pending' THEN 1 ELSE 0 END) AS PENDING, TO_CHAR(MIN(MATCH_DATE),'YYYY-MM-DD') AS FIRST_DATE, TO_CHAR(MAX(MATCH_DATE),'YYYY-MM-DD') AS LAST_DATE FROM ADMIN.DS_SELECTIONS GROUP BY SOURCE_TYPE`,[],opts);
   const strategyCounts=await connection.execute('SELECT ss.STRATEGY_ID, COUNT(*) AS TOTAL FROM ADMIN.DS_SELECTION_STRATEGIES ss GROUP BY ss.STRATEGY_ID ORDER BY ss.STRATEGY_ID',[],opts);
   const strategyLinks=await connection.execute('SELECT COUNT(*) AS TOTAL FROM ADMIN.DS_SELECTION_STRATEGIES',[],opts);
   const builderCounts=await connection.execute('SELECT COUNT(*) AS TOTAL FROM ADMIN.DS_BUILDERS',[],opts);
   const legCounts=await connection.execute('SELECT COUNT(*) AS TOTAL FROM ADMIN.DS_BUILDER_LEGS',[],opts);
   return res.status(200).json({source:'oracle',matches:m.rows[0].TOTAL,selections:s.rows[0].TOTAL,legacyOdds:o.rows[0].TOTAL,builders:builderCounts.rows[0].TOTAL,builderLegs:legCounts.rows[0].TOTAL,strategyLinks:strategyLinks.rows[0].TOTAL,strategyCounts:strategyCounts.rows,selectionSources:breakdown.rows});
  }
  const config={
   matches:{table:'ADMIN.DS_MATCHES',date:'MATCH_DATE',columns:"MATCH_ID, TO_CHAR(MATCH_DATE,'YYYY-MM-DD') AS MATCH_DATE, LEAGUE, HOME_TEAM, AWAY_TEAM, MATCH_LABEL, FINAL_SCORE",order:'MATCH_DATE DESC, MATCH_ID'},
   selections:{table:'ADMIN.DS_SELECTIONS',date:'MATCH_DATE',columns:"SELECTION_ID, MATCH_ID, TO_CHAR(MATCH_DATE,'YYYY-MM-DD') AS MATCH_DATE, SOURCE_TYPE, SELECTION_LABEL, ODDS, LEVEL_LABEL, RESULT_LABEL, RESULT_STATUS, PROFIT_UNITS",order:'MATCH_DATE DESC, SELECTION_ID'},
   odds:{table:'ADMIN.DS_ODDS_DAILY_LEGACY',date:'MATCH_DATE',columns:"OBSERVATION_ID, TO_CHAR(OBSERVED_DATE,'YYYY-MM-DD') AS OBSERVED_DATE, TO_CHAR(MATCH_DATE,'YYYY-MM-DD') AS MATCH_DATE, MATCH_LABEL, LEAGUE, KICKOFF_LOCAL, SELECTION_LABEL, DECIMAL_ODDS, CONFIDENCE_LABEL",order:'MATCH_DATE DESC, OBSERVED_DATE DESC, OBSERVATION_ID'}
  }[kind];
  const conditions=[],binds={};
  if(from){conditions.push(config.date+">=TO_DATE(:fromDay,'YYYY-MM-DD')");binds.fromDay=from}
  if(to){conditions.push(config.date+"<TO_DATE(:toDay,'YYYY-MM-DD')+1");binds.toDay=to}
  const where=conditions.length?' WHERE '+conditions.join(' AND '):'';
  const sql=`SELECT ${config.columns} FROM ${config.table}${where} ORDER BY ${config.order} OFFSET :rowOffset ROWS FETCH NEXT :rowLimit ROWS ONLY`;
  const result=await connection.execute(sql,{...binds,rowOffset:offset,rowLimit:limit},opts);
  return res.status(200).json({source:'oracle',kind,offset,limit,items:result.rows,hasMore:result.rows.length===limit});
 }catch(e){
  console.error('Oracle archive read',{code:e.code||'READ_FAILED'});
  return res.status(503).json({errorCode:e.code||'READ_FAILED'});
 }finally{
  if(connection)try{await connection.close()}catch{}
  if(directory)try{await rm(directory,{recursive:true,force:true})}catch{}
 }
}
