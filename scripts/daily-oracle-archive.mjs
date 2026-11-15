// Daily Oracle archive synchronization. Runs only at 12:00 Europe/Sofia.
// The admin secret stays in GitHub Actions secrets; never exposed to browsers.
const base=(process.env.DEEPSTATS_URL||'https://deepstats-mobile.vercel.app').replace(/\/$/,'');
const token=process.env.ADMIN_ACCESS_TOKEN;
if(!token)throw Error('Missing ADMIN_ACCESS_TOKEN GitHub Actions secret');
const now=new Date();
const local=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Sofia',hour:'2-digit',hourCycle:'h23'}).format(now);
if(process.env.GITHUB_EVENT_NAME==='schedule'&&Number(local)!==12){
 console.log('Skipping: Sofia local hour is '+local+', expected 12');
 process.exit(0);
}
async function call(path,body){
 const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),26000);
 try{
  const response=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:ctrl.signal});
  const raw=await response.text();
  let data;try{data=JSON.parse(raw)}catch{throw Error('Non-JSON response HTTP '+response.status+': '+raw.slice(0,160))}
  if(!response.ok)throw Error('HTTP '+response.status+': '+JSON.stringify(data));
  return data;
 }finally{clearTimeout(timer)}
}
async function retry(path,body){
 let last;
 for(let attempt=1;attempt<=3;attempt++){
  try{return await call(path,body)}catch(e){last=e;console.warn('Attempt '+attempt+' failed: '+e.message);if(attempt<3)await new Promise(r=>setTimeout(r,attempt*3000))}
 }
 throw last;
}
const preview=await retry('/api/oracle-import-odds-legacy');
if(preview.invalidRows)throw Error('Invalid legacy odds rows: '+preview.invalidRows);
console.log('Historical odds eligible: '+preview.historicalObservations);
let offset=0,processed=0;
while(offset<preview.historicalObservations){
 const result=await retry('/api/oracle-import-odds-legacy',{confirm:'IMPORT_LEGACY_ODDS',offset});
 if(!Number.isInteger(result.nextOffset)||result.nextOffset<=offset||result.processed<1)throw Error('Invalid batch progress at '+offset);
 offset=result.nextOffset;processed+=result.processed;
 console.log('Odds '+processed+'/'+preview.historicalObservations+'; stored '+result.totalStored);
}
const full=await retry('/api/oracle-import-selections');
if(full.invalidRows)throw Error('Invalid full selection rows: '+full.invalidRows);
console.log('Full selections eligible: '+full.historicalSelections+'; unique matches: '+full.uniqueMatches);
let fullOffset=0;
while(fullOffset<full.historicalSelections){
 const result=await retry('/api/oracle-import-selections',{confirm:'IMPORT_FULL_SELECTIONS',offset:fullOffset});
 if(!Number.isInteger(result.nextOffset)||result.nextOffset<=fullOffset||result.processed<1)throw Error('Invalid full selection batch at '+fullOffset);
 fullOffset=result.nextOffset;
 console.log('Full selections '+fullOffset+'/'+full.historicalSelections);
}
const strategy=await retry('/api/oracle-import-strategies');
if(strategy.unmatched)throw Error('Unmatched historical strategy rows: '+JSON.stringify(strategy.unmatchedRows));
console.log('Strategy rows eligible: '+strategy.historicalSelectedRows+'; memberships: '+strategy.expectedLinks);
let strategyOffset=0,strategyLinksProcessed=0;
while(strategyOffset<strategy.historicalSelectedRows){
 const result=await retry('/api/oracle-import-strategies',{confirm:'IMPORT_STRATEGY_LINKS',offset:strategyOffset});
 if(!Number.isInteger(result.nextOffset)||result.nextOffset<=strategyOffset||result.processed<1)throw Error('Invalid strategy batch at '+strategyOffset);
 strategyOffset=result.nextOffset;strategyLinksProcessed+=result.linksProcessed;
 console.log('Strategy rows '+strategyOffset+'/'+strategy.historicalSelectedRows);
}
if(strategyLinksProcessed!==strategy.expectedLinks)throw Error('Strategy links processed '+strategyLinksProcessed+' expected '+strategy.expectedLinks);
const best=await retry('/api/oracle-import-best',{confirm:'IMPORT_ARCHIVE_BEST'});
console.log('Best archive import:',JSON.stringify(best));
const builderPreview=await retry('/api/oracle-import-builders');
if(builderPreview.invalid)throw Error('Invalid builder source rows: '+JSON.stringify(builderPreview.invalidRows));
console.log('Builders eligible: '+builderPreview.historicalBuilders+'; Best proposals: '+builderPreview.bestProposals+'; recorded: '+builderPreview.recordedBuilders+'; legs: '+builderPreview.builderLegs);
let builderOffset=0,builderLegsProcessed=0;
while(builderOffset<builderPreview.historicalBuilders){
 const result=await retry('/api/oracle-import-builders',{confirm:'IMPORT_BUILDERS',offset:builderOffset});
 if(!Number.isInteger(result.nextOffset)||result.nextOffset<=builderOffset||result.processed<1)throw Error('Invalid builder batch at '+builderOffset);
 builderOffset=result.nextOffset;builderLegsProcessed+=result.legsProcessed;
 console.log('Builders '+builderOffset+'/'+builderPreview.historicalBuilders);
}
if(builderLegsProcessed!==builderPreview.builderLegs)throw Error('Builder leg processing mismatch: '+builderLegsProcessed+'/'+builderPreview.builderLegs);
const summary=await retry('/api/oracle-archive?kind=summary');
console.log('Verified Oracle totals:',JSON.stringify(summary));
const fullStored=Number((summary.selectionSources||[]).find(x=>x.SOURCE_TYPE==='FULL')?.TOTAL||0);
const bestStored=Number((summary.selectionSources||[]).find(x=>x.SOURCE_TYPE==='BEST')?.TOTAL||0);
if(fullStored!==full.historicalSelections)throw Error('FULL mismatch: source '+full.historicalSelections+' / Oracle '+fullStored);
if(bestStored<best.importedSelections)throw Error('BEST mismatch: source '+best.importedSelections+' / Oracle '+bestStored);
const countsByStrategy=new Map((summary.strategyCounts||[]).map(x=>[x.STRATEGY_ID,Number(x.TOTAL)]));
for(const [key,count] of Object.entries(strategy.counts)){
 if(countsByStrategy.get(key)!==count)throw Error('Strategy '+key+' count mismatch: source '+count+' / Oracle '+(countsByStrategy.get(key)||0));
}
if(Number(summary.strategyLinks)!==strategy.expectedLinks)throw Error('Strategy membership mismatch: source '+strategy.expectedLinks+' / Oracle '+summary.strategyLinks);
console.log('AUDIT FULL '+fullStored+'/'+full.historicalSelections+'; BEST '+bestStored+'/'+best.importedSelections+'; ODDS '+summary.legacyOdds+'/'+preview.historicalObservations+'; BUILDERS '+summary.builders+'; BUILDER LEGS '+summary.builderLegs);

if(Number(summary.builders)!==builderPreview.historicalBuilders)throw Error('Builder count mismatch: '+summary.builders+'/'+builderPreview.historicalBuilders);
if(Number(summary.builderLegs)!==builderPreview.builderLegs)throw Error('Builder leg count mismatch: '+summary.builderLegs+'/'+builderPreview.builderLegs);
// Verify real performance metrics against independently calculated Google Sheets
// source data. Do not call the archival job successful on a count-only match.
for(const [source,expected] of [['best',builderPreview.bestSinglesStats],['bestBuilders',builderPreview.bestBuildersStats]]){
 const actual=(await retry('/api/oracle-stats?sources='+source)).selected;
 if(!actual||!expected)throw Error('Missing audit figures for '+source);
 for(const field of ['count','wins','losses','voids','pending']){
  if(Number(actual[field])!==Number(expected[field]))throw Error('Audit mismatch '+source+'.'+field+': Oracle '+actual[field]+' / Sheet '+expected[field]);
 }
 if(Math.abs(Number(actual.profit)-Number(expected.profit))>0.01)throw Error('Audit mismatch '+source+'.profit: Oracle '+actual.profit+' / Sheet '+expected.profit);
 console.log('VERIFIED PERFORMANCE '+source+': '+JSON.stringify({count:actual.count,wins:actual.wins,losses:actual.losses,voids:actual.voids,pending:actual.pending,profit:actual.profit,yield:actual.yield}));
}
// Smoke-test each authenticated archive view; a successful data import should
// also imply that the mobile application can read its historical sections.
for(const kind of ['matches','selections','best','strategies','builders','builderlegs','odds']){
 const result=await retry('/api/history?kind='+encodeURIComponent(kind)+'&limit=2');
 if(result.kind!==kind||!Array.isArray(result.items))throw Error('History API returned invalid payload for '+kind);
 if(result.items.length===0)throw Error('History API returned no records for '+kind);
 console.log('ARCHIVE VIEW OK '+kind+': '+result.items.length+' sample rows');
}
if(summary.legacyOdds<preview.historicalObservations)throw Error('Oracle odds total below eligible source count');
console.log('DAILY ARCHIVE SUCCESS');
