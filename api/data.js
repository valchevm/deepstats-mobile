import {access,sheets,read,readFrom,ARCHIVE_ID,ID} from '../lib/_sheets.js';
import {timingSafeEqual} from 'node:crypto';
const clean=x=>String(x??'').trim().toLocaleLowerCase('bg-BG').replace(/[–—−]/g,'-').replace(/\s+/g,' ');
const iso=x=>{const s=String(x||'');if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;const m=s.match(/^(\d{2})[.\/-](\d{2})[.\/-](\d{4})$/);return m?m[3]+'-'+m[2]+'-'+m[1]:s};

function authorizedAdmin(req){
 const expected=process.env.ADMIN_ACCESS_TOKEN||'';
 const supplied=String(req.headers.authorization||'').replace(/^Bearer /,'');
 const a=Buffer.from(supplied),b=Buffer.from(expected);
 return !!expected&&!!supplied&&a.length===b.length&&timingSafeEqual(a,b);
}
const S={selections:"'СЕЛЕКЦИИ'!A11:O25000",best:"'СЕЛЕКЦИИ'!A3:O1000",strategy:"'СТРАТЕГИИ_ДАННИ'!A2:X25000",builders:"'ДАННИ'!L2:U25000",archive:"'АРХИВ BEST'!A2:L25000",summary:"'СТАТИСТИКА'!A5:F22"};
const txt=v=>String(v??'').trim();const num=v=>Number(txt(v).replace(/\s/g,'').replace(',','.').replace(/[^0-9.+-]/g,''))||0;
const valid=d=>/^\d{2}\.\d{2}\.\d{4}$/.test(d);
const dateKey=d=>{const m=txt(d).match(/^(\d{2})\.(\d{2})\.(\d{4})$/);return m?`${m[3]}-${m[2]}-${m[1]}`:''};
const inPeriod=(d,from,to)=>{const k=dateKey(d);return k&&(!from||k>=dateKey(from))&&(!to||k<=dateKey(to))};
const state=s=>{s=txt(s).toLowerCase();if(/печели|спечелен|win/.test(s))return'win';if(/губи|загуб|loss/.test(s))return'loss';if(/върнат|void|push/.test(s))return'void';return'pending'};
const strategyNames={A:'Отборни удари',B:'Точни удари',C:'Голове',D1:'Победа',D2:'Двоен шанс',D3:'Полувреме',E:'Гост 9/10',F:'Гост над 2.00'};
const keys=['A','B','C','D1','D2','D3','E','F'];const flags={A:13,B:14,C:15,D1:16,D2:17,D3:18,E:21,F:22};
function selections(rows){return rows.filter(r=>valid(txt(r[0]))&&txt(r[3])&&txt(r[4])).map((r,i)=>({id:'s'+i,date:txt(r[0]),time:txt(r[1]),league:txt(r[2]),match:txt(r[3]),selection:txt(r[4]),odds:num(r[9]),level:txt(r[10]),result:txt(r[11]),status:state(r[11]),matchId:txt(r[14]),checked:txt(r[12])==='✓'}))}
function strategies(rows){return rows.filter(r=>valid(txt(r[1]))&&txt(r[2])).map((r,i)=>({id:'t'+i,date:txt(r[1]),match:txt(r[2]),selection:txt(r[3]),odds:num(r[4]),level:txt(r[5]),result:txt(r[6]),status:state(r[6]),pl:txt(r[7])===''?null:num(r[7]),market:txt(r[10]),group:txt(r[12]),strategies:keys.filter(k=>num(r[flags[k]])===1)})).filter(r=>r.strategies.length)}
function currentBestRows(rows){const out=[];for(const r of rows){const date=txt(r[0]);if(!valid(date))break;out.push(r)}return out}
function eligibleBest(p){return /^(?:9\/10|10\/10|5\/5)$/.test(txt(p.level).replace(/\s/g,''))}
function builders(rows){return rows.filter(r=>txt(r[0]).toLowerCase()==='билдър'&&valid(txt(r[1]))).map((r,i)=>({id:'b'+i,date:txt(r[1]),match:txt(r[2]),selection:txt(r[3]),legs:num(r[4]),odds:num(r[5]),result:txt(r[7]),status:state(r[7]),pl:txt(r[8])===''?null:num(r[8])}))}
function bestBuilderRows(rows){const days=new Map();for(const p of rows){if(!days.has(p.date))days.set(p.date,[]);days.get(p.date).push(p)}return [...days].map(([date,items])=>{const status=items.some(x=>x.status==='loss')?'loss':items.every(x=>x.status==='win'||x.status==='void')?(items.every(x=>x.status==='void')?'void':'win'):'pending';const odds=items.every(x=>Number.isFinite(x.odds)&&x.odds>1)?items.reduce((a,x)=>a*x.odds,1):null;const effective=items.every(x=>Number.isFinite(x.odds)&&x.odds>1)?items.reduce((a,x)=>a*(x.status==='void'?1:x.odds),1):null;return {id:'best-builder-'+date,date,match:'Best of the Day',selection:items.length+' селекции',legs:items.length,odds,status,pl:status==='loss'?-1:status==='void'?0:status==='win'&&effective!==null?effective-1:null}})}
function calc(rows){let wins=0,losses=0,voids=0,pending=0,profit=0,staked=0;for(const r of rows){if(r.status==='win')wins++;else if(r.status==='loss')losses++;else if(r.status==='void')voids++;else pending++;if(r.status!=='pending'){staked++;profit+=r.pl!==undefined&&r.pl!==null?r.pl:r.status==='win'?(r.odds-1):r.status==='loss'?-1:0}}return {count:rows.length,settled:staked,wins,losses,voids,pending,profit:+profit.toFixed(2),yield:staked?+(profit/staked*100).toFixed(2):0,wr:wins+losses?+(wins/(wins+losses)*100).toFixed(2):0}}
const filter=(rows,q)=>rows.filter(r=>inPeriod(r.date,q.from,q.to));
const historicalTabs={selections:'HISTORY_SELECTIONS',strategy:'HISTORY_STRATEGIES',builders:'HISTORY_DATA_BUILDERS',data:'HISTORY_DATA_SELECTIONS',extra:'HISTORY_DATA_EXTRA',odds:'HISTORY_ODDS'};
async function archiveRows(s,tab){try{const rows=await readFrom(s,ARCHIVE_ID,"'"+tab+"'!A2:AZ25000");return rows.map(r=>r.slice(3)).filter(r=>r.some(v=>txt(v)))}catch(e){if([400,403,404].includes(e.code)||[400,403,404].includes(e.response?.status)){console.warn('Archive unavailable or not yet authorized:',tab);return [];}console.error('Archive read failed:',tab,e.message);throw e}}
function unionRows(current,historical){const seen=new Set();return [...current,...historical].filter(r=>{const key=JSON.stringify(r);if(seen.has(key))return false;seen.add(key);return true})}
function uniqueEntries(rows){const seen=new Set();return rows.filter(r=>{const key=[r.date,r.match,r.selection,r.odds,r.result].join('|');if(seen.has(key))return false;seen.add(key);return true})}
const send=(res,data)=>{res.setHeader('Cache-Control','private, no-store');return res.json(data)};
export default async function handler(req,res){if(req.method!=='GET')return res.status(405).end();if(!authorizedAdmin(req)&&!access(req,res))return;try{
const kind=txt(req.query.kind||'dashboard');const from=txt(req.query.from||req.query.date),to=txt(req.query.to||req.query.date);if((from&&!valid(from))||(to&&!valid(to)))return res.status(400).json({error:'Невалидна дата.'});const s=await sheets();
if(kind==='match-stats'){
 const match=clean(req.query.match),date=iso(req.query.date),id=String(req.query.id||'').trim();
 if(!match&&!id)return res.status(400).json({error:'Липсва мач или Match ID'});
  const rows=await read(s,"'МАЧОВЕ JSON'!A2:K25000");
  const candidates=rows.filter(r=>r[7]&&(id&&String(r[4]||'').trim()===id||match&&clean(r[3])===match&&(!date||iso(r[0])===date)));
  if(!candidates.length)return res.status(404).json({error:'За този мач още няма налична статистика.'});
  const r=candidates[0];let data;
  try{data=JSON.parse(r[7])}catch{return res.status(422).json({error:'Невалиден JSON за избрания мач.'})}
  if(!data||typeof data.sections!=='object'||Array.isArray(data.sections))return res.status(422).json({error:'Липсват статистически раздели.'});
  res.setHeader('Cache-Control','private, max-age=60');
  return res.status(200).json({date:r[0],time:r[1],league:r[2],match:r[3],id:r[4],strategy:r[5],count:Number(r[6])||null,coverage:r[9],data});
}
if(kind==='dashboard'){const [stat,best,summary]=await Promise.all([read(s,S.summary),read(s,S.best),read(s,"'ДНЕВЕН ЦЕНТЪР'!M3:Q10")]);const metrics={};stat.forEach(r=>{if(r[0])metrics[txt(r[0])]={selections:txt(r[1]),builders:txt(r[3]),total:txt(r[5])}});return send(res,{metrics,best:selections(best),strategySummary:summary.map((r,i)=>({key:keys[i],name:strategyNames[keys[i]],count:num(r[1]),settled:num(r[2]),profit:num(r[3]),yield:num(r[4])})),updatedAt:new Date().toISOString()})}
// Independent beta filters: definitions live in the lightweight БЕТА СТРАТЕГИИ tab.
// Match records remain in СТРАТЕГИИ_ДАННИ; no duplicate match rows are written.
if(kind==='beta'){
 const [raw,config]=await Promise.all([read(s,S.strategy),read(s,"'БЕТА СТРАТЕГИИ'!A3:G10")]);
 const defs=config.filter(r=>txt(r[0])&&txt(r[1])).map((r,i)=>({key:'BETA'+(i+1),name:txt(r[0]),market:txt(r[1]),target:txt(r[2])||'*',direction:txt(r[3])||'*',minLevel:num(r[4]),minOdds:num(r[5]),maxOdds:num(r[6])||999}));
 const all=raw.filter(r=>txt(r[0])==='Селекция'&&valid(txt(r[1]))&&txt(r[2])&&txt(r[3])).map((r,i)=>({id:'beta-'+i,date:txt(r[1]),match:txt(r[2]),selection:txt(r[3]),odds:num(r[4]),level:txt(r[5]),result:txt(r[6]),status:state(r[6]),pl:txt(r[7])===''?null:num(r[7]),target:txt(r[9]),market:txt(r[10]),direction:txt(r[11])}));
 const groups=defs.map(d=>{const rows=all.filter(p=>p.market===d.market&&(d.target==='*'||p.target===d.target)&&(d.direction==='*'||p.direction===d.direction)&&(Number.parseInt(p.level,10)||0)>=d.minLevel&&p.odds>=d.minOdds&&p.odds<=d.maxOdds);return {key:d.key,name:d.name,criteria:d,stats:calc(rows),items:filter(rows,{from,to})}});
 const unique=new Map();for(const g of groups)for(const p of g.items){const k=[p.date,p.match,p.selection].join('|');if(!unique.has(k))unique.set(k,{...p,betaStrategies:[g.key],betaNames:[g.name]});else{const q=unique.get(k);q.betaStrategies.push(g.key);q.betaNames.push(g.name)}}
 const days=new Map();for(const p of unique.values()){if(p.status==='pending')continue;days.set(p.date,(days.get(p.date)||0)+(p.pl??(p.status==='win'?p.odds-1:p.status==='loss'?-1:0)))}
 const allMatched=new Map();for(const g of groups){const d=g.criteria;for(const p of all){if(p.market!==d.market||(d.target!=='*'&&p.target!==d.target)||(d.direction!=='*'&&p.direction!==d.direction)||(Number.parseInt(p.level,10)||0)<d.minLevel||p.odds<d.minOdds||p.odds>d.maxOdds)continue;allMatched.set([p.date,p.match,p.selection].join('|'),p)}}
 return send(res,{groups,summary:calc([...allMatched.values()]),items:[...unique.values()],daily:[...days].sort((a,b)=>dateKey(a[0]).localeCompare(dateKey(b[0]))).map(([date,pl])=>({date,pl:+pl.toFixed(2)})),source:'sheets'});
}
if(kind==='ten10'){
 const [current,old]=await Promise.all([read(s,S.strategy),archiveRows(s,historicalTabs.strategy)]);
 const seen=new Map();for(const r of unionRows(current,old)){
  if(txt(r[0])!=='Селекция'||!valid(txt(r[1]))||!txt(r[2])||!txt(r[3])||txt(r[5]).replace(/\\s/g,'')!=='10/10')continue;
  const key=[txt(r[1]),txt(r[2]),txt(r[3]),num(r[4])].join('|');
  const p={id:'ten-'+seen.size,date:txt(r[1]),match:txt(r[2]),selection:txt(r[3]),odds:num(r[4]),level:'10/10',result:txt(r[6]),status:state(r[6]),pl:txt(r[7])===''?null:num(r[7]),market:txt(r[10]),group:txt(r[12])};
  if(!seen.has(key)||seen.get(key).status==='pending'&&p.status!=='pending')seen.set(key,p);
 }
 const all=[...seen.values()],items=filter(all,{from,to});
 const daily=new Map();for(const p of items){if(p.status==='pending')continue;daily.set(p.date,(daily.get(p.date)||0)+(p.pl??(p.status==='win'?p.odds-1:p.status==='loss'?-1:0)))}
 return send(res,{items,stats:calc(items),daily:[...daily].sort((a,b)=>dateKey(a[0]).localeCompare(dateKey(b[0]))).map(([date,pl])=>({date,pl:+pl.toFixed(2)})),name:'Всички 10/10'});
}
if(kind==='matches'){const [main,best,old]=await Promise.all([read(s,S.selections),read(s,S.best),archiveRows(s,historicalTabs.selections)]);const a=uniqueEntries(selections(unionRows(main,old))),b=selections(best);const ids=new Set(a.map(p=>[p.date,p.match,p.selection].join('|')));const merged=[...a,...b.filter(p=>!ids.has([p.date,p.match,p.selection].join('|')))];return send(res,{items:filter(merged,{from,to}),count:merged.length})}
if(kind==='strategies'){const [current,old]=await Promise.all([read(s,S.strategy),archiveRows(s,historicalTabs.strategy)]);const rows=uniqueEntries(strategies(unionRows(current,old)));const period=filter(rows,{from,to});const by=keys.map(k=>{const items=period.filter(r=>r.strategies.includes(k));return {key:k,name:strategyNames[k],stats:calc(items),items}});return send(res,{groups:by,stats:calc(period.filter(r=>r.strategies.length)),dates:[...new Set(rows.map(r=>r.date))].sort((a,b)=>dateKey(b).localeCompare(dateKey(a)))})}
if(kind==='builders'){
 const [br,allBest,liveBest,oldBuilders]=await Promise.all([read(s,S.builders),read(s,S.archive),read(s,S.best),archiveRows(s,historicalTabs.builders)]);
 const own=filter(uniqueEntries(builders(unionRows(br,oldBuilders))),{from,to});
 const historical=selections(allBest).filter(eligibleBest);const current=selections(currentBestRows(liveBest)).filter(eligibleBest);
 const known=new Set(historical.map(r=>[r.date,r.match,r.selection].join('|')));
 const best=filter([...historical,...current.filter(r=>!known.has([r.date,r.match,r.selection].join('|')))],{from,to});
 const days=new Map();for(const p of best){if(!days.has(p.date))days.set(p.date,[]);days.get(p.date).push(p)}
 const proposals=[...days].map(([date,items])=>({id:'best-'+date,date,items,legs:items.length,odds:items.length&&items.every(r=>Number.isFinite(r.odds)&&r.odds>1)?items.reduce((v,r)=>v*r.odds,1):null,status:items.some(r=>r.status==='loss')?'loss':items.length&&items.every(r=>['win','void'].includes(r.status))?(items.every(r=>r.status==='void')?'void':'win'):'pending'})).sort((a,b)=>dateKey(b.date).localeCompare(dateKey(a.date)));
 return send(res,{items:own,proposals,stats:calc(own),allCount:br.length});
 }
if(kind==='statistics'){
 const [sr,br,sel,arch,best,oldSr,oldBr,oldSel]=await Promise.all([read(s,S.strategy),read(s,S.builders),read(s,"'ДАННИ'!A2:J25000"),read(s,S.archive),read(s,S.best),archiveRows(s,historicalTabs.strategy),archiveRows(s,historicalTabs.builders),archiveRows(s,historicalTabs.data)]);
 const st=uniqueEntries(strategies(unionRows(sr,oldSr))),bu=uniqueEntries(builders(unionRows(br,oldBr)));
 const all=unionRows(sel,oldSel).filter(r=>txt(r[0])==='Селекция'&&valid(txt(r[1]))).map((r,i)=>({id:'a'+i,date:txt(r[1]),match:txt(r[2]),selection:txt(r[3]),odds:num(r[5]),result:txt(r[7]),status:state(r[7]),pl:txt(r[8])===''?null:num(r[8])}));
 const historical=selections(arch),current=selections(best),existing=new Set(historical.map(r=>[r.date,r.match,r.selection].join('|')));
 const bestItems=[...historical,...current.filter(r=>!existing.has([r.date,r.match,r.selection].join('|')))];
 const bestBuilderItems=bestBuilderRows(bestItems);
 const selected=txt(req.query.sources).split(',').filter(Boolean);const sources=txt(req.query.sources)==='none'?[]:(selected.length?selected:['all']);
 const allowed=new Set(['all','builders','best','bestBuilders',...keys]);if(sources.some(x=>!allowed.has(x)))return res.status(400).json({error:'Невалиден избор на категория.'});
 const groups=keys.map(k=>({key:k,name:strategyNames[k],stats:calc(filter(st.filter(r=>r.strategies.includes(k)),{from,to}))}));
 const scoped={all:filter(all,{from,to}),builders:filter(bu,{from,to}),best:filter(bestItems,{from,to}),bestBuilders:filter(bestBuilderItems,{from,to})};
 const picked=[];const seen=new Set();for(const source of sources){const rows=keys.includes(source)?filter(st.filter(r=>r.strategies.includes(source)),{from,to}):scoped[source];for(const row of rows){const key=(source==='builders'||source==='bestBuilders')?source+'|'+row.date+'|'+row.match+'|'+row.selection:row.date+'|'+row.match+'|'+row.selection;if(seen.has(key))continue;seen.add(key);picked.push(row)}}
 const daily=new Map();for(const r of picked){if(r.status==='pending')continue;daily.set(r.date,(daily.get(r.date)||0)+(r.pl??(r.status==='win'?r.odds-1:r.status==='loss'?-1:0)))}
 return send(res,{selected:calc(picked),selectedSources:sources,all:calc(scoped.all),builders:calc(scoped.builders),best:calc(scoped.best),bestBuilders:calc(scoped.bestBuilders),groups,daily:[...daily].sort((a,b)=>dateKey(a[0]).localeCompare(dateKey(b[0]))).map(([date,pl])=>({date,pl:+pl.toFixed(2)}))});
}
if(kind==='archive'){const rows=selections(await read(s,S.archive));return send(res,{items:filter(rows,{from,to})})}
return res.status(400).json({error:'Непозната заявка.'});}catch(e){console.error('data endpoint:',e);return res.status(500).json({error:'Неуспешно зареждане. Опитай отново.'})}}
