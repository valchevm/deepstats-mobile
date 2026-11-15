import {access} from './_sheets.js';
import oracledb from 'oracledb';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const KEYS=['A','B','C','D1','D2','D3','E','F'];
const NAMES={A:'Удари',B:'Точни удари',C:'Голове',D1:'Победа',D2:'Двоен шанс',D3:'Полувреме',E:'Гост 9/10',F:'Гост над 2'};
const allowed=new Set(['all','best','builders','bestBuilders',...KEYS]);
const dateFormat=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)?d:null;
function calc(items){
 const out={count:items.length,settled:0,wins:0,losses:0,voids:0,pending:0,profit:0,yield:0,wr:0};
 for(const r of items){
  const st=r.status;
  if(st==='win')out.wins++;
  else if(st==='loss')out.losses++;
  else if(st==='void')out.voids++;
  else {out.pending++;continue}
  out.settled++;
  out.profit+=Number(r.pl??(st==='win'?(Number(r.odds)||1)-1:st==='loss'?-1:0));
 }
 out.profit=Number(out.profit.toFixed(4));
 out.yield=out.settled?Number((100*out.profit/out.settled).toFixed(2)):0;
 out.wr=out.wins+out.losses?Number((100*out.wins/(out.wins+out.losses)).toFixed(2)):0;
 return out;
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 if(!access(req,res))return;
 const from=String(req.query.from||''),to=String(req.query.to||'');
 if((from&&!dateFormat(from))||(to&&!dateFormat(to))||(from&&to&&from>to))return res.status(400).json({error:'Invalid date range'});
 const raw=String(req.query.sources??'all');
 const sources=raw==='none'?[]:[...new Set(raw.split(',').map(x=>x.trim()).filter(Boolean))];
 if(sources.some(x=>!allowed.has(x)))return res.status(400).json({error:'Invalid category'});
 let directory,connection;
 try{
  directory=await mkdtemp(join(tmpdir(),'deepstats-wallet-'));
  await writeFile(join(directory,'ewallet.pem'),process.env.ORACLE_WALLET_PEM,{mode:0o600});
  connection=await oracledb.getConnection({user:process.env.ORACLE_USER,password:process.env.ORACLE_PASSWORD,connectString:process.env.ORACLE_CONNECT_STRING,walletLocation:directory,walletPassword:process.env.ORACLE_WALLET_PASSWORD});
  const binds={};
  const where=[];
  if(from){where.push("s.MATCH_DATE>=TO_DATE(:fromDay,'YYYY-MM-DD')");binds.fromDay=from}
  if(to){where.push("s.MATCH_DATE<TO_DATE(:toDay,'YYYY-MM-DD')+1");binds.toDay=to}
  const sql=`WITH picks AS (
    SELECT s.SELECTION_ID,s.MATCH_DATE,s.SELECTION_LABEL,s.ODDS,s.RESULT_STATUS,s.PROFIT_UNITS,s.SOURCE_TYPE,m.MATCH_LABEL,
    ROW_NUMBER() OVER(PARTITION BY s.MATCH_DATE,TRIM(m.MATCH_LABEL),TRIM(s.SELECTION_LABEL)
      ORDER BY CASE WHEN s.SOURCE_TYPE='FULL' THEN 0 WHEN s.SOURCE_TYPE='BEST' THEN 1 ELSE 2 END,s.SELECTION_ID) AS RN,
    MAX(CASE WHEN s.SOURCE_TYPE='BEST' THEN 1 ELSE 0 END) OVER(
      PARTITION BY s.MATCH_DATE,TRIM(m.MATCH_LABEL),TRIM(s.SELECTION_LABEL)) AS IS_BEST
    FROM ADMIN.DS_SELECTIONS s JOIN ADMIN.DS_MATCHES m ON m.MATCH_ID=s.MATCH_ID
    ${where.length?'WHERE '+where.join(' AND '):''}
   )
   SELECT SELECTION_ID,TO_CHAR(MATCH_DATE,'YYYY-MM-DD') AS DAY_KEY,MATCH_LABEL,SELECTION_LABEL,ODDS,RESULT_STATUS,PROFIT_UNITS,IS_BEST
   FROM picks WHERE RN=1`;
  const [pickResult,linkResult,builderResult,bestResult,legResult]=await Promise.all([
   connection.execute(sql,binds,{outFormat:oracledb.OUT_FORMAT_OBJECT,maxRows:25000}),
   connection.execute("SELECT SELECTION_ID,STRATEGY_ID FROM ADMIN.DS_SELECTION_STRATEGIES",[],{outFormat:oracledb.OUT_FORMAT_OBJECT,maxRows:25000}),
   connection.execute(`SELECT BUILDER_ID,TO_CHAR(BUILDER_DATE,'YYYY-MM-DD') AS DAY_KEY,BUILDER_TYPE,ODDS,RESULT_STATUS,PROFIT_UNITS FROM ADMIN.DS_BUILDERS
    ${from||to?'WHERE '+[from?"BUILDER_DATE>=TO_DATE(:fromDay,'YYYY-MM-DD')":null,to?"BUILDER_DATE<TO_DATE(:toDay,'YYYY-MM-DD')+1":null].filter(Boolean).join(' AND '):''}`,
    binds,{outFormat:oracledb.OUT_FORMAT_OBJECT,maxRows:25000}),
   connection.execute(`SELECT TO_CHAR(s.MATCH_DATE,'YYYY-MM-DD') AS DAY_KEY,m.MATCH_LABEL,s.SELECTION_LABEL,s.ODDS,s.RESULT_STATUS,s.PROFIT_UNITS FROM ADMIN.DS_SELECTIONS s JOIN ADMIN.DS_MATCHES m ON m.MATCH_ID=s.MATCH_ID
    WHERE s.SOURCE_TYPE='BEST' ${where.length?'AND '+where.join(' AND '):''}`,binds,{outFormat:oracledb.OUT_FORMAT_OBJECT,maxRows:25000}),
   connection.execute(`SELECT l.BUILDER_ID,l.LEG_NUMBER,l.ODDS,l.RESULT_STATUS FROM ADMIN.DS_BUILDER_LEGS l JOIN ADMIN.DS_BUILDERS b ON b.BUILDER_ID=l.BUILDER_ID
    ${from||to?'WHERE '+[from?"b.BUILDER_DATE>=TO_DATE(:fromDay,'YYYY-MM-DD')":null,to?"b.BUILDER_DATE<TO_DATE(:toDay,'YYYY-MM-DD')+1":null].filter(Boolean).join(' AND '):''}`,
    binds,{outFormat:oracledb.OUT_FORMAT_OBJECT,maxRows:25000})
  ]);
  const belongs=new Map();
  for(const r of linkResult.rows){if(!belongs.has(r.SELECTION_ID))belongs.set(r.SELECTION_ID,new Set());belongs.get(r.SELECTION_ID).add(r.STRATEGY_ID)}
  // The master archive remains unique, while Best singles use the odds and
  // settlement from their curated Best source, linked to that same logical pick.
  const rowKey=(day,match,selection)=>[day,match,selection].map(x=>String(x||'').trim()).join('|');
  const picks=pickResult.rows.map(r=>({id:'selection:'+r.SELECTION_ID,day:r.DAY_KEY,match:r.MATCH_LABEL,selection:r.SELECTION_LABEL,odds:r.ODDS,status:r.RESULT_STATUS,pl:r.PROFIT_UNITS,isBest:Number(r.IS_BEST)===1,strategies:belongs.get(r.SELECTION_ID)||new Set()}));
  const byKey=new Map(picks.map(x=>[rowKey(x.day,x.match,x.selection),x]));
  const bestSingles=new Map();
  for(const r of bestResult.rows){
   const k=rowKey(r.DAY_KEY,r.MATCH_LABEL,r.SELECTION_LABEL);
   const master=byKey.get(k);
   if(!master)continue;
   const st=r.RESULT_STATUS;
   const rawPL=r.PROFIT_UNITS;
   bestSingles.set(k,{...master,odds:r.ODDS,status:st,pl:rawPL,isBest:true});
  }
  const recorded=[],proposals=[],legsByBuilder=new Map();
  for(const r of legResult.rows){
   if(!legsByBuilder.has(r.BUILDER_ID))legsByBuilder.set(r.BUILDER_ID,[]);
   legsByBuilder.get(r.BUILDER_ID).push(r);
  }
  for(const r of builderResult.rows){
   const item={id:'builder:'+r.BUILDER_ID,day:r.DAY_KEY,odds:r.ODDS,status:r.RESULT_STATUS,pl:r.PROFIT_UNITS};
   if(r.BUILDER_TYPE==='BEST_PROPOSAL'){
    const legs=legsByBuilder.get(r.BUILDER_ID)||[];
    if(!legs.length){proposals.push({...item,status:'pending',pl:null});continue}
    const statuses=legs.map(x=>x.RESULT_STATUS);
    const status=statuses.includes('loss')?'loss':statuses.includes('pending')?'pending':statuses.every(x=>x==='void')?'void':'win';
    const pricesValid=legs.every(x=>Number(x.ODDS)>1&&Number.isFinite(Number(x.ODDS)));
    const effective=pricesValid?legs.reduce((p,x)=>p*(x.RESULT_STATUS==='void'?1:Number(x.ODDS)),1):null;
    const pl=status==='loss'?-1:status==='void'?0:status==='win'&&effective!==null?effective-1:null;
    proposals.push({...item,status,pl});
   }else if(r.BUILDER_TYPE==='RECORDED')recorded.push(item);
  }
  const groupStats=KEYS.map(k=>({key:k,name:NAMES[k],stats:calc(picks.filter(x=>x.strategies.has(k)))}));
  const baskets={all:picks,best:[...bestSingles.values()],builders:recorded,bestBuilders:proposals};
  const chosen=new Map();
  for(const source of sources){
   const arr=KEYS.includes(source)?picks.filter(x=>x.strategies.has(source)):baskets[source]||[];
   for(const row of arr)chosen.set(row.id,row);
  }
  const selected=[...chosen.values()];
  const daily=new Map();
  for(const r of selected){
   if(r.status==='pending')continue;
   const pl=Number(r.pl??(r.status==='win'?(Number(r.odds)||1)-1:r.status==='loss'?-1:0));
   daily.set(r.day,(daily.get(r.day)||0)+pl);
  }
  return res.status(200).json({
   source:'oracle',historical:true,selectedSources:sources,
   selected:calc(selected),all:calc(picks),best:calc(baskets.best),
   builders:calc(recorded),bestBuilders:calc(proposals),
   groups:groupStats,uniqueSelections:picks.length,
   daily:[...daily.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([date,pl])=>({date,pl:Number(pl.toFixed(4))}))
  });
 }catch(e){console.error('Oracle statistics',e.code||'STATS_FAILED');return res.status(503).json({error:'Статистиката от Oracle е временно недостъпна.'})}
 finally{if(connection)try{await connection.close()}catch{}if(directory)try{await rm(directory,{recursive:true,force:true})}catch{}}
}
