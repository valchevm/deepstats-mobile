import {access} from './_sheets.js';
import oracledb from 'oracledb';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 if(!access(req,res))return;
 const kind=String(req.query.kind||'matches');
 if(!['matches','selections','odds'].includes(kind))return res.status(400).json({error:'Invalid kind'});
 const limit=Number(req.query.limit??50),offset=Number(req.query.offset??0);
 if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0||offset>1000000)return res.status(400).json({error:'Invalid pagination'});
 const from=String(req.query.from||''),to=String(req.query.to||'');
 if((from&&!/^\d{4}-\d{2}-\d{2}$/.test(from))||(to&&!/^\d{4}-\d{2}-\d{2}$/.test(to)))return res.status(400).json({error:'Invalid dates'});
 const cfg={
  matches:{table:'ADMIN.DS_MATCHES',columns:"MATCH_ID, TO_CHAR(MATCH_DATE,'YYYY-MM-DD') AS MATCH_DATE, LEAGUE, HOME_TEAM, AWAY_TEAM, MATCH_LABEL, FINAL_SCORE",order:'MATCH_DATE DESC, MATCH_ID'},
  selections:{table:'ADMIN.DS_SELECTIONS',columns:"SELECTION_ID, MATCH_ID, TO_CHAR(MATCH_DATE,'YYYY-MM-DD') AS MATCH_DATE, SELECTION_LABEL, ODDS, LEVEL_LABEL, RESULT_LABEL, RESULT_STATUS, PROFIT_UNITS",order:'MATCH_DATE DESC, SELECTION_ID'},
  odds:{table:'ADMIN.DS_ODDS_DAILY_LEGACY',columns:"TO_CHAR(OBSERVED_DATE,'YYYY-MM-DD') AS OBSERVED_DATE, TO_CHAR(MATCH_DATE,'YYYY-MM-DD') AS MATCH_DATE, MATCH_LABEL, LEAGUE, SELECTION_LABEL, DECIMAL_ODDS, CONFIDENCE_LABEL",order:'MATCH_DATE DESC, OBSERVED_DATE DESC, OBSERVATION_ID'}
 }[kind];
 const binds={rowOffset:offset,rowLimit:limit},where=[];
 if(from){where.push("MATCH_DATE>=TO_DATE(:fromDay,'YYYY-MM-DD')");binds.fromDay=from}
 if(to){where.push("MATCH_DATE<TO_DATE(:toDay,'YYYY-MM-DD')+1");binds.toDay=to}
 let directory,connection;
 try{
  directory=await mkdtemp(join(tmpdir(),'deepstats-wallet-'));
  await writeFile(join(directory,'ewallet.pem'),process.env.ORACLE_WALLET_PEM,{mode:0o600});
  connection=await oracledb.getConnection({user:process.env.ORACLE_USER,password:process.env.ORACLE_PASSWORD,connectString:process.env.ORACLE_CONNECT_STRING,walletLocation:directory,walletPassword:process.env.ORACLE_WALLET_PASSWORD});
  const sql=`SELECT ${cfg.columns} FROM ${cfg.table}${where.length?' WHERE '+where.join(' AND '):''} ORDER BY ${cfg.order} OFFSET :rowOffset ROWS FETCH NEXT :rowLimit ROWS ONLY`;
  const result=await connection.execute(sql,binds,{outFormat:oracledb.OUT_FORMAT_OBJECT});
  return res.status(200).json({source:'oracle',kind,offset,limit,items:result.rows,hasMore:result.rows.length===limit});
 }catch(e){console.error('Public archive read',e.code||'READ_FAILED');return res.status(503).json({error:'Архивът временно не е достъпен.'})}
 finally{if(connection)try{await connection.close()}catch{}if(directory)try{await rm(directory,{recursive:true,force:true})}catch{}}
}
