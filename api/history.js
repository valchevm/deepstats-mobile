import {access} from './_sheets.js';
import {timingSafeEqual} from 'node:crypto';
import oracledb from 'oracledb';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function authorizedAdmin(req){
 const expected=process.env.ADMIN_ACCESS_TOKEN||'';
 const supplied=String(req.headers.authorization||'').replace(/^Bearer /,'');
 const a=Buffer.from(supplied),b=Buffer.from(expected);
 return !!expected&&!!supplied&&a.length===b.length&&timingSafeEqual(a,b);
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 if(!authorizedAdmin(req)&&!access(req,res))return;
 const kind=String(req.query.kind||'matches');
 if(!['matches','selections','best','strategies','builders','builderlegs','odds'].includes(kind))return res.status(400).json({error:'Invalid kind'});
 const limit=Number(req.query.limit??50),offset=Number(req.query.offset??0);
 if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0||offset>1000000)return res.status(400).json({error:'Invalid pagination'});
 const from=String(req.query.from||''),to=String(req.query.to||'');
 if((from&&!/^\d{4}-\d{2}-\d{2}$/.test(from))||(to&&!/^\d{4}-\d{2}-\d{2}$/.test(to)))return res.status(400).json({error:'Invalid dates'});
 const binds={rowOffset:offset,rowLimit:limit},where=[];
 if(from){where.push("MATCH_DATE>=TO_DATE(:fromDay,'YYYY-MM-DD')");binds.fromDay=from}
 if(to){where.push("MATCH_DATE<TO_DATE(:toDay,'YYYY-MM-DD')+1");binds.toDay=to}
 let directory,connection;
 try{
  directory=await mkdtemp(join(tmpdir(),'deepstats-wallet-'));
  await writeFile(join(directory,'ewallet.pem'),process.env.ORACLE_WALLET_PEM,{mode:0o600});
  connection=await oracledb.getConnection({user:process.env.ORACLE_USER,password:process.env.ORACLE_PASSWORD,connectString:process.env.ORACLE_CONNECT_STRING,walletLocation:directory,walletPassword:process.env.ORACLE_WALLET_PASSWORD});
  const filter=where.length?' WHERE '+where.join(' AND '):'';
  let sql;
  if(kind==='matches'){
   // Full and Best imports can have distinct database IDs for the same real match.
   sql=`SELECT MATCH_ID, TO_CHAR(MATCH_DATE,'YYYY-MM-DD') AS MATCH_DATE, LEAGUE, HOME_TEAM, AWAY_TEAM, MATCH_LABEL, FINAL_SCORE FROM (
    SELECT m.*, ROW_NUMBER() OVER(PARTITION BY MATCH_DATE, TRIM(MATCH_LABEL) ORDER BY CASE WHEN MATCH_ID LIKE 'full:%' THEN 0 ELSE 1 END, MATCH_ID) AS RN
    FROM ADMIN.DS_MATCHES m${filter}
   ) WHERE RN=1 ORDER BY MATCH_DATE DESC,MATCH_LABEL OFFSET :rowOffset ROWS FETCH NEXT :rowLimit ROWS ONLY`;
  }else if(kind==='selections'||kind==='best'){
   // One canonical row per dated match + selection, while preserving its Best membership.
   const bestOnly=kind==='best'?' AND IS_BEST=1':'';
   const primarySource=kind==='best'?'BEST':'FULL';
   sql=`WITH source_rows AS (
    SELECT s.SELECTION_ID,s.MATCH_ID,s.MATCH_DATE,s.SELECTION_LABEL,s.ODDS,s.LEVEL_LABEL,s.RESULT_LABEL,s.RESULT_STATUS,s.PROFIT_UNITS,s.SOURCE_TYPE,m.MATCH_LABEL,m.LEAGUE,
    ROW_NUMBER() OVER(PARTITION BY s.MATCH_DATE,TRIM(m.MATCH_LABEL),TRIM(s.SELECTION_LABEL) ORDER BY CASE WHEN s.SOURCE_TYPE='${primarySource}' THEN 0 ELSE 1 END,s.SELECTION_ID) AS RN,
    MAX(CASE WHEN s.SOURCE_TYPE='BEST' THEN 1 ELSE 0 END) OVER(PARTITION BY s.MATCH_DATE,TRIM(m.MATCH_LABEL),TRIM(s.SELECTION_LABEL)) AS IS_BEST
    FROM ADMIN.DS_SELECTIONS s JOIN ADMIN.DS_MATCHES m ON m.MATCH_ID=s.MATCH_ID${filter.replaceAll('MATCH_DATE','s.MATCH_DATE')}
   )
   SELECT SELECTION_ID,MATCH_ID,TO_CHAR(MATCH_DATE,'YYYY-MM-DD') AS MATCH_DATE,MATCH_LABEL,LEAGUE,SELECTION_LABEL,ODDS,LEVEL_LABEL,RESULT_LABEL,RESULT_STATUS,PROFIT_UNITS,IS_BEST
   FROM source_rows WHERE RN=1${bestOnly} ORDER BY MATCH_DATE DESC,MATCH_LABEL,SELECTION_LABEL OFFSET :rowOffset ROWS FETCH NEXT :rowLimit ROWS ONLY`;
  }else if(kind==='strategies'){
   sql=`SELECT ss.STRATEGY_ID, st.STRATEGY_NAME, TO_CHAR(s.MATCH_DATE,'YYYY-MM-DD') AS MATCH_DATE, m.MATCH_LABEL, s.SELECTION_LABEL, s.ODDS, s.RESULT_STATUS, s.PROFIT_UNITS
    FROM ADMIN.DS_SELECTION_STRATEGIES ss
    JOIN ADMIN.DS_SELECTIONS s ON s.SELECTION_ID=ss.SELECTION_ID
    JOIN ADMIN.DS_STRATEGIES st ON st.STRATEGY_ID=ss.STRATEGY_ID
    JOIN ADMIN.DS_MATCHES m ON m.MATCH_ID=s.MATCH_ID
    ${filter.replaceAll('MATCH_DATE','s.MATCH_DATE')}
    ORDER BY s.MATCH_DATE DESC,ss.STRATEGY_ID,m.MATCH_LABEL,s.SELECTION_LABEL
    OFFSET :rowOffset ROWS FETCH NEXT :rowLimit ROWS ONLY`;
  }else if(kind==='builders'){
   sql=`SELECT b.BUILDER_ID,TO_CHAR(b.BUILDER_DATE,'YYYY-MM-DD') AS MATCH_DATE,b.BUILDER_TYPE,b.ODDS,b.RESULT_STATUS,b.PROFIT_UNITS,COUNT(l.LEG_NUMBER) AS LEGS
    FROM ADMIN.DS_BUILDERS b LEFT JOIN ADMIN.DS_BUILDER_LEGS l ON l.BUILDER_ID=b.BUILDER_ID
    ${filter.replaceAll('MATCH_DATE','b.BUILDER_DATE')}
    GROUP BY b.BUILDER_ID,b.BUILDER_DATE,b.BUILDER_TYPE,b.ODDS,b.RESULT_STATUS,b.PROFIT_UNITS
    ORDER BY b.BUILDER_DATE DESC,b.BUILDER_TYPE,b.BUILDER_ID
    OFFSET :rowOffset ROWS FETCH NEXT :rowLimit ROWS ONLY`;
  }else if(kind==='builderlegs'){
   sql=`SELECT TO_CHAR(b.BUILDER_DATE,'YYYY-MM-DD') AS MATCH_DATE,b.BUILDER_TYPE,b.BUILDER_ID,l.LEG_NUMBER,l.MATCH_LABEL,l.SELECTION_LABEL,l.ODDS,l.RESULT_STATUS
    FROM ADMIN.DS_BUILDER_LEGS l JOIN ADMIN.DS_BUILDERS b ON b.BUILDER_ID=l.BUILDER_ID
    ${filter.replaceAll('MATCH_DATE','b.BUILDER_DATE')}
    ORDER BY b.BUILDER_DATE DESC,b.BUILDER_ID,l.LEG_NUMBER
    OFFSET :rowOffset ROWS FETCH NEXT :rowLimit ROWS ONLY`;
  }else{
   sql=`SELECT TO_CHAR(OBSERVED_DATE,'YYYY-MM-DD') AS OBSERVED_DATE, TO_CHAR(MATCH_DATE,'YYYY-MM-DD') AS MATCH_DATE, MATCH_LABEL, LEAGUE, SELECTION_LABEL, DECIMAL_ODDS, CONFIDENCE_LABEL FROM ADMIN.DS_ODDS_DAILY_LEGACY${filter} ORDER BY MATCH_DATE DESC, OBSERVED_DATE DESC, OBSERVATION_ID OFFSET :rowOffset ROWS FETCH NEXT :rowLimit ROWS ONLY`;
  }
  const result=await connection.execute(sql,{...binds,rowLimit:limit+1},{outFormat:oracledb.OUT_FORMAT_OBJECT});
  return res.status(200).json({source:'oracle',kind,offset,limit,items:result.rows.slice(0,limit),hasMore:result.rows.length>limit});
 }catch(e){console.error('Public archive read',e.code||'READ_FAILED');return res.status(503).json({error:'Архивът временно не е достъпен.'})}
 finally{if(connection)try{await connection.close()}catch{}if(directory)try{await rm(directory,{recursive:true,force:true})}catch{}}
}
