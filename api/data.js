import {access,sheets,read,readFrom,ARCHIVE_ID,ID} from './_sheets.js';
const S={selections:"'СЕЛЕКЦИИ'!A11:O25000",best:"'СЕЛЕКЦИИ'!A3:O8",strategy:"'СТРАТЕГИИ_ДАННИ'!A2:X25000",builders:"'ДАННИ'!L2:U25000",archive:"'АРХИВ BEST'!A2:L25000",summary:"'СТАТИСТИКА'!A5:F22"};
const txt=v=>String(v??'').trim();const num=v=>Number(txt(v).replace(/\s/g,'').replace(',','.').replace(/[^0-9.+-]/g,''))||0;
const valid=d=>/^\d{2}\.\d{2}\.\d{4}$/.test(d);
const dateKey=d=>{const m=txt(d).match(/^(\d{2})\.(\d{2})\.(\d{4})$/);return m?`${m[3]}-${m[2]}-${m[1]}`:''};
const inPeriod=(d,from,to)=>{const k=dateKey(d);return k&&(!from||k>=dateKey(from))&&(!to||k<=dateKey(to))};
const state=s=>{s=txt(s).toLowerCase();if(/печели|спечелен|win/.test(s))return'win';if(/губи|загуб|loss/.test(s))return'loss';if(/върнат|void|push/.test(s))return'void';return'pending'};
const strategyNames={A:'Отборни удари',B:'Точни удари',C:'Голове',D1:'Победа',D2:'Двоен шанс',D3:'Полувреме',E:'Гост 9/10',F:'Гост над 2.00'};
const keys=['A','B','C','D1','D2','D3','E','F'];const flags={A:13,B:14,C:15,D1:16,D2:17,D3:18,E:21,F:22};
function selections(rows){return rows.filter(r=>valid(txt(r[0]))&&txt(r[3])&&txt(r[4])).map((r,i)=>({id:'s'+i,date:txt(r[0]),time:txt(r[1]),league:txt(r[2]),match:txt(r[3]),selection:txt(r[4]),odds:num(r[9]),level:txt(r[10]),result:txt(r[11]),status:state(r[11]),matchId:txt(r[14]),checked:txt(r[12])==='✓'}))}
function strategies(rows){return rows.filter(r=>valid(txt(r[1]))&&txt(r[2])).map((r,i)=>({id:'t'+i,date:txt(r[1]),match:txt(r[2]),selection:txt(r[3]),odds:num(r[4]),level:txt(r[5]),result:txt(r[6]),status:state(r[6]),pl:txt(r[7])===''?null:num(r[7]),market:txt(r[10]),group:txt(r[12]),strategies:keys.filter(k=>num(r[flags[k]])===1)})).filter(r=>r.strategies.length)}
function builders(rows){return rows.filter(r=>txt(r[0]).toLowerCase()==='билдър'&&valid(txt(r[1]))).map((r,i)=>({id:'b'+i,date:txt(r[1]),match:txt(r[2]),selection:txt(r[3]),legs:num(r[4]),odds:num(r[5]),result:txt(r[7]),status:state(r[7]),pl:txt(r[8])===''?null:num(r[8])}))}
function calc(rows){let wins=0,losses=0,voids=0,pending=0,profit=0,staked=0;for(const r of rows){if(r.status==='win')wins++;else if(r.status==='loss')losses++;else if(r.status==='void')voids++;else pending++;if(r.status!=='pending'){staked++;profit+=r.pl!==undefined&&r.pl!==null?r.pl:r.status==='win'?(r.odds-1):r.status==='loss'?-1:0}}return {count:rows.length,settled:staked,wins,losses,voids,pending,profit:+profit.toFixed(2),yield:staked?+(profit/staked*100).toFixed(2):0,wr:wins+losses?+(wins/(wins+losses)*100).toFixed(2):0}}
const filter=(rows,q)=>rows.filter(r=>inPeriod(r.date,q.from,q.to));
const historicalTabs={selections:'HISTORY_SELECTIONS',strategy:'HISTORY_STRATEGIES',builders:'HISTORY_DATA_BUILDERS',data:'HISTORY_DATA_SELECTIONS',extra:'HISTORY_DATA_EXTRA',odds:'HISTORY_ODDS'};
async function archiveRows(s,tab){try{const rows=await readFrom(s,ARCHIVE_ID,"'"+tab+"'!A2:AZ25000");return rows.map(r=>r.slice(3)).filter(r=>r.some(v=>txt(v)))}catch(e){if(e.code===404||e.code===400||e.response?.status===404||e.response?.status===400)return [];console.error('Archive read failed:',tab,e.message);throw e}}
function unionRows(current,historical){const seen=new Set();return [...current,...historical].filter(r=>{const key=JSON.stringify(r);if(seen.has(key))return false;seen.add(key);return true})}
const send=(res,data)=>{res.setHeader('Cache-Control','private, no-store');return res.json(data)};
export default async function handler(req,res){if(req.method!=='GET')return res.status(405).end();if(!access(req,res))return;try{
const kind=txt(req.query.kind||'dashboard');const from=txt(req.query.from||req.query.date),to=txt(req.query.to||req.query.date);if((from&&!valid(from))||(to&&!valid(to)))return res.status(400).json({error:'Невалидна дата.'});const s=await sheets();
if(kind==='dashboard'){const [stat,best,summary]=await Promise.all([read(s,S.summary),read(s,S.best),read(s,"'ДНЕВЕН ЦЕНТЪР'!M3:Q10")]);const metrics={};stat.forEach(r=>{if(r[0])metrics[txt(r[0])]={selections:txt(r[1]),builders:txt(r[3]),total:txt(r[5])}});return send(res,{metrics,best:selections(best),strategySummary:summary.map((r,i)=>({key:keys[i],name:strategyNames[keys[i]],count:num(r[1]),settled:num(r[2]),profit:num(r[3]),yield:num(r[4])})),updatedAt:new Date().toISOString()})}
if(kind==='matches'){const [main,best,old]=await Promise.all([read(s,S.selections),read(s,S.best),archiveRows(s,historicalTabs.selections)]);const a=selections(unionRows(main,old)),b=selections(best);const ids=new Set(a.map(p=>[p.date,p.match,p.selection].join('|')));const merged=[...a,...b.filter(p=>!ids.has([p.date,p.match,p.selection].join('|')))];return send(res,{items:filter(merged,{from,to}),count:merged.length})}
if(kind==='strategies'){const [current,old]=await Promise.all([read(s,S.strategy),archiveRows(s,historicalTabs.strategy)]);const rows=strategies(unionRows(current,old));const period=filter(rows,{from,to});const by=keys.map(k=>{const items=period.filter(r=>r.strategies.includes(k));return {key:k,name:strategyNames[k],stats:calc(items),items}});return send(res,{groups:by,stats:calc(period.filter(r=>r.strategies.length)),dates:[...new Set(rows.map(r=>r.date))].sort((a,b)=>dateKey(b).localeCompare(dateKey(a)))})}
if(kind==='builders'){
 const [br,allBest,liveBest,oldBuilders]=await Promise.all([read(s,S.builders),read(s,S.archive),read(s,S.best),archiveRows(s,historicalTabs.builders)]);
 const own=filter(builders(unionRows(br,oldBuilders)),{from,to});
 const historical=selections(allBest);const current=selections(liveBest);
 const known=new Set(historical.map(r=>[r.date,r.match,r.selection].join('|')));
 const best=filter([...historical,...current.filter(r=>!known.has([r.date,r.match,r.selection].join('|')))],{from,to});
 const days=new Map();for(const p of best){if(!days.has(p.date))days.set(p.date,[]);days.get(p.date).push(p)}
 const proposals=[...days].map(([date,items])=>({id:'best-'+date,date,items,legs:items.length,odds:items.reduce((v,r)=>v*(r.odds||1),1),status:'proposal'})).sort((a,b)=>dateKey(b.date).localeCompare(dateKey(a.date)));
 return send(res,{items:own,proposals,stats:calc(own),allCount:br.length});
 }
if(kind==='statistics'){
 const [sr,br,sel,arch,best,oldSr,oldBr,oldSel]=await Promise.all([read(s,S.strategy),read(s,S.builders),read(s,"'ДАННИ'!A2:J25000"),read(s,S.archive),read(s,S.best),archiveRows(s,historicalTabs.strategy),archiveRows(s,historicalTabs.builders),archiveRows(s,historicalTabs.data)]);
 const st=strategies(unionRows(sr,oldSr)),bu=builders(unionRows(br,oldBr));
 const all=unionRows(sel,oldSel).filter(r=>txt(r[0])==='Селекция'&&valid(txt(r[1]))).map((r,i)=>({id:'a'+i,date:txt(r[1]),match:txt(r[2]),selection:txt(r[3]),odds:num(r[5]),result:txt(r[7]),status:state(r[7]),pl:txt(r[8])===''?null:num(r[8])}));
 const historical=selections(arch),current=selections(best),existing=new Set(historical.map(r=>[r.date,r.match,r.selection].join('|')));
 const bestItems=[...historical,...current.filter(r=>!existing.has([r.date,r.match,r.selection].join('|')))];
 const selected=txt(req.query.sources).split(',').filter(Boolean);const sources=txt(req.query.sources)==='none'?[]:(selected.length?selected:['all']);
 const allowed=new Set(['all','builders','best',...keys]);if(sources.some(x=>!allowed.has(x)))return res.status(400).json({error:'Невалиден избор на категория.'});
 const groups=keys.map(k=>({key:k,name:strategyNames[k],stats:calc(filter(st.filter(r=>r.strategies.includes(k)),{from,to}))}));
 const scoped={all:filter(all,{from,to}),builders:filter(bu,{from,to}),best:filter(bestItems,{from,to})};
 const picked=[];const seen=new Set();for(const source of sources){const rows=keys.includes(source)?filter(st.filter(r=>r.strategies.includes(source)),{from,to}):scoped[source];for(const row of rows){const key=source==='builders'?'builder|'+row.date+'|'+row.match+'|'+row.selection:row.date+'|'+row.match+'|'+row.selection;if(seen.has(key))continue;seen.add(key);picked.push(row)}}
 const daily=new Map();for(const r of picked){if(r.status==='pending')continue;daily.set(r.date,(daily.get(r.date)||0)+(r.pl??(r.status==='win'?r.odds-1:r.status==='loss'?-1:0)))}
 return send(res,{selected:calc(picked),selectedSources:sources,all:calc(scoped.all),builders:calc(scoped.builders),best:calc(scoped.best),groups,daily:[...daily].sort((a,b)=>dateKey(a[0]).localeCompare(dateKey(b[0]))).map(([date,pl])=>({date,pl:+pl.toFixed(2)}))});
}
if(kind==='archive'){const rows=selections(await read(s,S.archive));return send(res,{items:filter(rows,{from,to})})}
return res.status(400).json({error:'Непозната заявка.'});}catch(e){console.error('data endpoint:',e);return res.status(500).json({error:'Неуспешно зареждане. Опитай отново.'})}}
