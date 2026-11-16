/* DeepStats isolated demo: fictional records; no production API calls. */
sessionStorage.setItem('ds-token','DEMO_ONLY');
const day=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Sofia',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date()).replaceAll('/','.');
const mk=(id,match,league,time,selection,odds,level,extra={})=>({id:'demo-'+id,date:day,time,match,league,selection,odds,level,status:'pending',checked:id%2===0,homeLast10:'7/10',awayLast10:'6/10',...extra});
const items=[
mk(1,'Arsenal - Brighton','Англия · Висша лига','17:00','Над 2.5 гола',1.84,'Високо'),
mk(2,'Arsenal - Brighton','Англия · Висша лига','17:00','Гол/Гол',1.78,'Средно'),
mk(3,'Bayer Leverkusen - Mainz','Германия · Бундеслига','16:30','Победа домакин',1.67,'Високо'),
mk(4,'Real Sociedad - Villarreal','Испания · Ла Лига','19:30','Над 8.5 корнера',1.91,'Средно'),
mk(5,'Atalanta - Torino','Италия · Серия А','21:45','Домакин над 4.5 точни удара',1.95,'Високо'),
mk(6,'Lille - Rennes','Франция · Лига 1','22:00','Гол/Гол',1.89,'Средно')];
const keys=['A','B','C','D1','D2','D3','E','F'];
const names=['Отборни удари','Точни удари','Голове','Победа','Двоен шанс','Полувреме','Гост 9/10','Гост над 2.00'];
const stats=(count=20,profit=3.8)=>({count,settled:count,win:Math.round(count*.65),loss:Math.round(count*.35),void:0,wr:65,profit,yield:profit/count*100,avgOdds:1.85,roi:profit/count*100});
const groups=keys.map((key,i)=>({key,name:names[i],stats:stats(16+i*3,2+i*.7),items:[items[i%items.length]]}));
const proposals=[{id:'demo-best',date:day,items:[items[0],items[2],items[4]],legs:3,odds:6.0,status:'pending'}];
const daily=Array.from({length:12},(_,i)=>({date:String(i+1).padStart(2,'0')+'.11.2026',pl:i%4===0?-1:1.3}));
const statistics={selected:stats(145,24.8),all:stats(145,24.8),builders:stats(38,6.4),best:stats(54,12.2),bestBuilders:stats(30,8.3),groups,daily,selectedSources:['all'],source:'demo'};
const originalFetch=window.fetch.bind(window);
window.fetch=async function(input,init){const url=new URL(typeof input==='string'?input:input.url,location.href);if(!url.pathname.startsWith('/api/'))return originalFetch(input,init);let result={};if(url.pathname==='/api/data'){const kind=url.searchParams.get('kind');if(kind==='matches')result={items,count:items.length};else if(kind==='strategies')result={groups,stats:stats(),dates:[day]};else if(kind==='builders')result={items:[],proposals,stats:stats(20,3),allCount:0};else if(kind==='statistics')result=statistics;else if(kind==='dashboard')result={metrics:{},best:items,strategySummary:groups.map(g=>({key:g.key,name:g.name,count:g.stats.count,settled:g.stats.settled,profit:g.stats.profit,yield:g.stats.yield})),updatedAt:new Date().toISOString()};else if(kind==='archive')result={items};else result={items:[]};}
else if(url.pathname==='/api/oracle-stats')result={...statistics,source:'DEMO · SportMonks-style mock',sources:keys,groups};
else if(url.pathname==='/api/history')result={items:[],rows:[],total:0,count:0};
else if(url.pathname==='/api/crests')result={url:null};
else result={items:[]};
return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}})
};