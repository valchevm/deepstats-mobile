// Internal handler: preserves existing API behavior; mounted via api/oracle-archive.js.
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
const hash=v=>createHash('sha256').update(v).digest('hex').slice(0,36);
const clean=v=>String(v??'').trim();
function dateOf(v){
 const m=clean(v).match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
 if(!m)return null;
 const d=`${m[3]}-${m[2]}-${m[1]}`;
 const value=new Date(d+'T00:00:00Z');
 return Number.isNaN(value.getTime())||value.toISOString().slice(0,10)!==d?null:d;
}
function num(v){if(clean(v)==='')return null;const n=Number(clean(v).replace(',','.'));return Number.isFinite(n)?n:null}
function status(v){
 const s=clean(v).toLowerCase();
 if(/печели|спечелен|win/.test(s))return 'win';
 if(/губи|загуб|loss/.test(s))return 'loss';
 if(/върнат|void|push/.test(s))return 'void';
 return 'pending';
}
function build(best,own,today){
 const grouped=new Map(),invalid=[];
 for(let i=1;i<best.length;i++){
  const r=best[i],day=dateOf(r?.[0]);if(!day||day>=today)continue;
  const match=clean(r[3]),selection=clean(r[4]),odds=num(r[9]);
  if(!match||!selection||!(odds>1)){invalid.push({source:'АРХИВ BEST',row:i+1});continue}
  if(!grouped.has(day))grouped.set(day,[]);
  grouped.get(day).push({match,selection,odds,status:status(r[11]),sourceRow:i+1});
 }
 const builders=[];
 for(const [day,legs] of grouped){
  const odds=legs.reduce((n,r)=>n*r.odds,1);
  // Model-performance simulation: one unit per Best single and one
  // separate unit per daily accumulator; not proof that a bet was placed.
  const statuses=legs.map(x=>x.status);
  const st=statuses.includes('loss')?'loss':statuses.includes('pending')?'pending':statuses.every(x=>x==='void')?'void':'win';
  const effective=legs.reduce((n,x)=>n*(x.status==='void'?1:x.odds),1);
  const profit=st==='loss'?-1:st==='void'?0:st==='win'?effective-1:null;
  builders.push({id:'best-day:'+day,day,type:'BEST_PROPOSAL',odds,st,profit,raw:JSON.stringify({source:'АРХИВ BEST',betPlaced:false,modelPerformance:true,legs:legs.length}),legs:legs.map(x=>({...x,selectionId:null}))});
 }
 for(let i=1;i<own.length;i++){
  const r=own[i],day=dateOf(r?.[1]);if(!day||day>=today||clean(r[0]).toLowerCase()!=='билдър')continue;
  const match=clean(r[2]),description=clean(r[3]),odds=num(r[5]),count=num(r[4]),st=status(r[7]),profit=num(r[8]);
  if(!match||!description||!(odds>1)||!Number.isInteger(count)||count<1||count>50){invalid.push({source:'ДАННИ',row:i+1});continue}
  // Only split when the source's explicit leg count agrees; never invent odds per leg.
  const split=description.split(/\s+\+\s+/).map(clean);
  const legLabels=split.length===count?split:[description];
  const legs=legLabels.map(selection=>({match,selection,odds:null,status:'pending',selectionId:null}));
  const id='recorded:'+hash(day+'|'+match+'|'+description+'|'+(i+1));
  builders.push({id,day,type:'RECORDED',odds,st,profit,raw:JSON.stringify({source:'ДАННИ',row:i+1,description,declaredLegs:count,parsedLegs:legLabels.length,hasLegOdds:false}),legs});
 }
 const bestLegs=[...grouped.values()].flat();
 const bestSinglesProfit=bestLegs.reduce((n,r)=>n+(r.status==='win'?r.odds-1:r.status==='loss'?-1:0),0);
 const bestSinglesStats={count:bestLegs.length,wins:bestLegs.filter(x=>x.status==='win').length,losses:bestLegs.filter(x=>x.status==='loss').length,voids:bestLegs.filter(x=>x.status==='void').length,pending:bestLegs.filter(x=>x.status==='pending').length,profit:Number(bestSinglesProfit.toFixed(4))};
 const proposalRows=builders.filter(x=>x.type==='BEST_PROPOSAL');
 const bestBuildersStats={count:proposalRows.length,wins:proposalRows.filter(x=>x.st==='win').length,losses:proposalRows.filter(x=>x.st==='loss').length,voids:proposalRows.filter(x=>x.st==='void').length,pending:proposalRows.filter(x=>x.st==='pending').length,profit:Number(proposalRows.reduce((n,x)=>n+(x.profit??0),0).toFixed(4))};
 return {builders,invalid,bestCount:grouped.size,recordedCount:builders.filter(x=>x.type==='RECORDED').length,legCount:builders.reduce((s,x)=>s+x.legs.length,0),bestSinglesStats,bestBuildersStats};
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
 if(!authorized(req))return res.status(403).json({error:'Forbidden'});
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Sofia',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 let best,own;
 try{
  const s=await sheets();
  [best,own]=await Promise.all([read(s,"'АРХИВ BEST'!A1:L25000"),read(s,"'ДАННИ'!L1:U25000")]);
 }catch(e){console.error('Builder source read',e.code||'FAILED');return res.status(503).json({errorCode:'SHEETS_READ_FAILED'})}
 const data=build(best,own,today);
 if(req.method==='GET')return res.status(200).json({source:'АРХИВ BEST + ДАННИ',historicalBuilders:data.builders.length,bestProposals:data.bestCount,recordedBuilders:data.recordedCount,builderLegs:data.legCount,bestSinglesStats:data.bestSinglesStats,bestBuildersStats:data.bestBuildersStats,invalid:data.invalid.length,invalidRows:data.invalid.slice(0,10)});
 if(req.body?.confirm!=='IMPORT_BUILDERS')return res.status(400).json({error:'Confirmation required'});
 if(data.invalid.length)return res.status(409).json({errorCode:'INVALID_BUILDER_ROWS',invalidRows:data.invalid.slice(0,10)});
 const offset=req.body?.offset;
 if(!Number.isInteger(offset)||offset<0||offset>data.builders.length)return res.status(400).json({error:'Invalid offset'});
 const batch=data.builders.slice(offset,offset+4);
 if(!batch.length)return res.status(200).json({processed:0,nextOffset:offset,expected:data.builders.length});
 let directory,connection;
 try{
  directory=await mkdtemp(join(tmpdir(),'deepstats-wallet-'));
  await writeFile(join(directory,'ewallet.pem'),process.env.ORACLE_WALLET_PEM,{mode:0o600});
  connection=await oracledb.getConnection({user:process.env.ORACLE_USER,password:process.env.ORACLE_PASSWORD,connectString:process.env.ORACLE_CONNECT_STRING,walletLocation:directory,walletPassword:process.env.ORACLE_WALLET_PASSWORD});
  for(const x of batch){
   await connection.execute(`MERGE INTO ADMIN.DS_BUILDERS t USING(SELECT :builderKey AS k FROM dual) s ON(t.BUILDER_ID=s.k)
    WHEN MATCHED THEN UPDATE SET ODDS=:oddsValue,RESULT_STATUS=:resultStatus,PROFIT_UNITS=:profitValue,SOURCE_ROW_JSON=:rawJson
    WHEN NOT MATCHED THEN INSERT(BUILDER_ID,BUILDER_DATE,BUILDER_TYPE,ODDS,RESULT_STATUS,PROFIT_UNITS,SOURCE_ROW_JSON)
    VALUES(:insertKey,TO_DATE(:dateValue,'YYYY-MM-DD'),:builderType,:insertOdds,:insertStatus,:insertProfit,:insertRaw)`,
    {builderKey:x.id,oddsValue:x.odds,resultStatus:x.st,profitValue:x.profit,rawJson:x.raw,insertKey:x.id,dateValue:x.day,builderType:x.type,insertOdds:x.odds,insertStatus:x.st,insertProfit:x.profit,insertRaw:x.raw});
   for(let i=0;i<x.legs.length;i++){
    const leg=x.legs[i];
    await connection.execute(`MERGE INTO ADMIN.DS_BUILDER_LEGS t USING(SELECT :builderKey AS b,:legNumber AS n FROM dual) s ON(t.BUILDER_ID=s.b AND t.LEG_NUMBER=s.n)
    WHEN MATCHED THEN UPDATE SET MATCH_LABEL=:matchLabel,SELECTION_LABEL=:selectionLabel,ODDS=:legOdds,RESULT_STATUS=:legStatus
    WHEN NOT MATCHED THEN INSERT(BUILDER_ID,LEG_NUMBER,MATCH_LABEL,SELECTION_LABEL,ODDS,RESULT_STATUS)
    VALUES(:insertKey,:insertNumber,:insertMatch,:insertSelection,:insertOdds,:insertStatus)`,
    {builderKey:x.id,legNumber:i+1,matchLabel:leg.match,selectionLabel:leg.selection,legOdds:leg.odds,legStatus:leg.status,insertKey:x.id,insertNumber:i+1,insertMatch:leg.match,insertSelection:leg.selection,insertOdds:leg.odds,insertStatus:leg.status});
   }
   // Refresh stale legs when a daily proposal is corrected in the sheet.
   await connection.execute('DELETE FROM ADMIN.DS_BUILDER_LEGS WHERE BUILDER_ID=:builderKey AND LEG_NUMBER>:maxLegs',{builderKey:x.id,maxLegs:x.legs.length});
  }
  await connection.commit();
  return res.status(200).json({processed:batch.length,legsProcessed:batch.reduce((n,x)=>n+x.legs.length,0),nextOffset:offset+batch.length,expected:data.builders.length});
 }catch(e){if(connection)try{await connection.rollback()}catch{}console.error('Builder import',e.code||'IMPORT_FAILED');return res.status(503).json({errorCode:e.code||'IMPORT_FAILED'})}
 finally{if(connection)try{await connection.close()}catch{}if(directory)try{await rm(directory,{recursive:true,force:true})}catch{}}
}
