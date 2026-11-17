import {timingSafeEqual,createHash} from 'node:crypto';
import {sheets,read} from '../lib/_sheets.js';
import oracledb from 'oracledb';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const KEYS=['A','B','C','D1','D2','D3','E','F'];
const FLAGS={A:13,B:14,C:15,D1:16,D2:17,D3:18,E:21,F:22};
const NAMES={A:'Отборни удари',B:'Точни удари',C:'Голове',D1:'Победа',D2:'Двоен шанс',D3:'Полувреме',E:'Гост 9/10',F:'Гост над 2.00'};
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
function hash(v){return createHash('sha256').update(v).digest('hex').slice(0,36)}
function key(day,match,selection){return [day,match,selection].map(x=>String(x||'').trim()).join('|')}
function prepare(selections,strategies,today){
 const source=new Map(),duplicateKeys=new Set();
 for(let i=0;i<selections.length;i++){
  const r=selections[i],day=dateOf(r?.[0]);
  if(!day||day>=today||!String(r[3]||'').trim()||!String(r[4]||'').trim())continue;
  const k=key(day,r[3],r[4]);
  if(source.has(k))duplicateKeys.add(k);
  source.set(k,'full:'+hash([day,String(r[3]).trim(),String(r[4]).trim(),String(r[5]||''),i+11].join('|')));
 }
 const records=[],invalid=[],counts=Object.fromEntries(KEYS.map(k=>[k,0]));
 const seen=new Set();
 for(let i=0;i<strategies.length;i++){
  const r=strategies[i],day=dateOf(r?.[1]);
  if(!day||day>=today)continue;
  const ids=KEYS.filter(k=>String(r[FLAGS[k]]||'').trim()==='1');
  if(!ids.length)continue;
  const k=key(day,r[2],r[3]),selectionId=source.get(k);
  if(!selectionId||duplicateKeys.has(k)||seen.has(k)){invalid.push({row:i+2,match:String(r[2]||''),selection:String(r[3]||''),reason:!selectionId?'not_in_selections':duplicateKeys.has(k)?'ambiguous':'duplicate_strategy_row'});continue}
  seen.add(k);ids.forEach(x=>counts[x]++);
  records.push({selectionId,strategies:ids});
 }
 return {records,invalid,counts,links:records.reduce((n,r)=>n+r.strategies.length,0)};
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
 if(!authorized(req))return res.status(403).json({error:'Forbidden'});
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Sofia',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 let sel,strategies;
 try{
  const s=await sheets();
  [sel,strategies]=await Promise.all([read(s,"'СЕЛЕКЦИИ'!A11:O25000"),read(s,"'СТРАТЕГИИ_ДАННИ'!A2:X25000")]);
 }catch(e){console.error('Strategy source read',e.code||'FAILED');return res.status(503).json({errorCode:'SHEETS_READ_FAILED'})}
 const data=prepare(sel,strategies,today);
 if(req.method==='GET')return res.status(200).json({mode:'preview',source:'СТРАТЕГИИ_ДАННИ',historicalSelectedRows:data.records.length,expectedLinks:data.links,counts:data.counts,unmatched:data.invalid.length,unmatchedRows:data.invalid.slice(0,12)});
 if(req.body?.confirm!=='IMPORT_STRATEGY_LINKS')return res.status(400).json({error:'Confirmation required'});
 if(data.invalid.length)return res.status(409).json({errorCode:'UNMATCHED_STRATEGY_SELECTIONS',count:data.invalid.length,rows:data.invalid.slice(0,12)});
 const offset=req.body?.offset;
 if(!Number.isInteger(offset)||offset<0||offset>data.records.length)return res.status(400).json({error:'Invalid offset'});
 const batch=data.records.slice(offset,offset+20);
 if(!batch.length)return res.status(200).json({processed:0,nextOffset:offset,expected:data.records.length});
 let directory,connection;
 try{
  directory=await mkdtemp(join(tmpdir(),'deepstats-wallet-'));
  await writeFile(join(directory,'ewallet.pem'),process.env.ORACLE_WALLET_PEM,{mode:0o600});
  connection=await oracledb.getConnection({user:process.env.ORACLE_USER,password:process.env.ORACLE_PASSWORD,connectString:process.env.ORACLE_CONNECT_STRING,walletLocation:directory,walletPassword:process.env.ORACLE_WALLET_PASSWORD});
  for(const strategyId of KEYS){
   await connection.execute(`MERGE INTO ADMIN.DS_STRATEGIES t USING (SELECT :sid AS k FROM dual) s ON (t.STRATEGY_ID=s.k) WHEN MATCHED THEN UPDATE SET STRATEGY_NAME=:strategyName WHEN NOT MATCHED THEN INSERT (STRATEGY_ID,STRATEGY_NAME) VALUES (:sid2,:strategyName2)`,{sid:strategyId,sid2:strategyId,strategyName:NAMES[strategyId],strategyName2:NAMES[strategyId]});
  }
  let inserted=0;
  for(const r of batch){
   const chk=await connection.execute('SELECT COUNT(*) FROM ADMIN.DS_SELECTIONS WHERE SELECTION_ID=:selectionId AND SOURCE_TYPE=\'FULL\' AND MATCH_DATE<TO_DATE(:todayDay,\'YYYY-MM-DD\')',{selectionId:r.selectionId,todayDay:today});
   if(Number(chk.rows?.[0]?.[0])!==1)throw Object.assign(Error('Missing referenced FULL selection'),{code:'MISSING_FULL_SELECTION'});
   for(const strategyId of r.strategies){
    await connection.execute(`MERGE INTO ADMIN.DS_SELECTION_STRATEGIES t USING (SELECT :selectionId AS selKey,:strategyId AS strategyKey FROM dual) s ON (t.SELECTION_ID=s.selKey AND t.STRATEGY_ID=s.strategyKey) WHEN NOT MATCHED THEN INSERT (SELECTION_ID,STRATEGY_ID) VALUES (:selectionId2,:strategyId2)`,{selectionId:r.selectionId,strategyId,selectionId2:r.selectionId,strategyId2:strategyId});
    inserted++;
   }
  }
  await connection.commit();
  return res.status(200).json({processed:batch.length,linksProcessed:inserted,nextOffset:offset+batch.length,expectedRows:data.records.length,expectedLinks:data.links});
 }catch(e){if(connection)try{await connection.rollback()}catch{}console.error('Strategy import',e.code||'IMPORT_FAILED');return res.status(503).json({errorCode:e.code||'IMPORT_FAILED'})}
 finally{if(connection)try{await connection.close()}catch{}if(directory)try{await rm(directory,{recursive:true,force:true})}catch{}}
}
