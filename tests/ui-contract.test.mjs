import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
import vm from 'node:vm';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>readFileSync(join(root,path),'utf8');
const html=read('public/index.html');
const app=read('public/app.js');
const css=read('public/style.css');
const sw=read('public/sw.js');

test('bottom navigation has exactly five destinations; builders and archive stay in profile',()=>{
 const tabs=[...html.matchAll(/data-tab="([^"]+)"/g)].map(m=>m[1]);
 assert.deepEqual(tabs,['home','matches','statistics','strategies','profile']);
 assert.match(app,/function profile\(\)/);
 assert.match(app,/data-goto="builders"/);
 assert.match(app,/data-goto="archive"/);
});
test('dark is default; light and dark remain selectable and persistent',()=>{
 assert.match(app,/savedTheme==='light'\?'light':'dark'/);
 assert.match(app,/localStorage\.setItem\('ds-theme'/);
 assert.match(html,/data-theme-toggle/);
 assert.match(app,/data-set-theme="dark"/);
 assert.match(app,/data-set-theme="light"/);
 assert.match(css,/html\[data-theme="light"\]/);
});
test('one consistent Data Analytics B dashboard with builder and directly visible strategy matches',()=>{
 assert.match(app,/document\.documentElement\.dataset\.design='B'/);
 assert.doesNotMatch(app,/data-set-design="A"/);
 assert.doesNotMatch(app,/data-set-design="C"/);
 assert.match(app,/ds20BestBuilder\(buildersData\.proposals,dateLabel\)/);
 assert.match(app,/dsStrategyAccordion\(af,'Стратегии A–F · днес','today-af'/);
 assert.match(app,/dsStrategyAccordion\(beta,'Beta Strategy · днес','today-beta'/);
 assert.match(app,/dsStrategyAccordion\(tenData.items\|\|\[\],'⭐ Всички 10\/10 · днес','today-ten'/);
 assert.doesNotMatch(app.slice(app.indexOf('async function home(){'),app.indexOf('async function matches(){')),/api\('matches'/);
 assert.doesNotMatch(app.slice(app.indexOf('function ds20StrategyWindow('),app.indexOf('function ds19StatsPanel(')),/<details/);
});
test('historical A-F Oracle panel lives in Statistics not the home fetch',()=>{
 assert.match(app,/strategyKeys=\['A','B','C','D1','D2','D3','E','F'\]/);
 assert.match(app,/async function statistics\(\)/);
 assert.match(app,/let historicalPanel=''/);
 assert.match(app,/ds19StatsPanel\(full\.selected,full,/);
 assert.match(app,/\$\{historicalPanel\}\$\{tenPanel\}\$\{betaPanel\}\$\{dates\(\)\}/);
 assert.doesNotMatch(app.slice(app.indexOf('async function home(){'),app.indexOf('async function matches(){')), /\/api\/oracle-stats/);
});
test('compact confidence and real crest folder are wired',()=>{
 assert.match(app,/ds20-confidence/);
 assert.match(app,/ds20-leg-crests/);
 assert.match(app,/fetch\('\/crests\/manifest\.json\?v=224'\)/);
 assert.match(css,/\.ds20-confidence/);
});
test('new scripts and styles share the same cache-busting versions',()=>{
 const appUrl=html.match(/\/app\.js\?v=\d+/)?.[0];
 const cssUrl=html.match(/\/style\.css\?v=\d+/)?.[0];
 assert.ok(appUrl&&cssUrl);
 assert.ok(sw.includes(appUrl));
 assert.ok(sw.includes(cssUrl));
 assert.match(sw,/const CACHE='deepstats-static-v\d+'/);
});
test('existing Oracle and Sheets API source files are still referenced',()=>{
 assert.match(app,/api\('builders'/);
 assert.match(app,/ds27VisibleMatches/);
 assert.match(app,/api\('strategies'/);
 assert.match(app,/\/api\/history\?kind=/);
 assert.match(app,/api\('statistics'/);
});

test('local club badge manifest only references existing files and tracks unresolved teams',()=>{
 const map=JSON.parse(read('public/crests/manifest.json'));
 const report=JSON.parse(read('public/crests/coverage.json'));
 assert.ok(report.total>=report.resolved);
 assert.ok(report.resolved>=250,'expected initial verified SVG batch');
 assert.equal(Object.keys(map).length,report.resolved);
 for(const [team,url] of Object.entries(map)){
  assert.ok(team && /^\/crests\/[a-z0-9._-]+\.(svg|png|jpg|webp)$/.test(url),'bad manifest URL '+url);
  assert.ok(existsSync(join(root,'public',url.slice(1))),'missing local badge '+url);
 }
 assert.ok(Array.isArray(report.unresolved));
});

test('Builder history renders without historical statistics scope errors',()=>{
 const builder=app.slice(app.indexOf('async function builders(){'),app.indexOf('function chart(points)'));
 const stats=app.slice(app.indexOf('async function statistics(){'));
 assert.doesNotMatch(builder,/historicalPanel/);
 assert.match(stats,/\$\{historicalPanel\}\$\{tenPanel\}\$\{betaPanel\}\$\{dates\(\)\}/);
 assert.match(builder,/Promise\.allSettled/);
 assert.match(builder,/oracleBuilderHistory/);
 assert.match(app,/t==='builders'\)\&\&state\.tab!==t\)state\.mode='all'/);
 assert.match(app,/kind=builders&type=/);
 assert.match(builder,/builderHistoryState\.offset/);
});
test('Oracle builder API filters builder types before paging',()=>{
 const history=read('api/history.js');
 assert.match(history,/BEST_PROPOSAL/);
 assert.match(history,/RECORDED/);
 assert.match(history,/builderFilter\.replaceAll\('MATCH_DATE','b\.BUILDER_DATE'\)/);
 assert.match(history,/b\.BUILDER_TYPE=:builderType/);
});

test('national teams and home nations resolve to genuine SVG flag codes without mistaking clubs for countries',()=>{
 const start=app.indexOf('const dsCountryMap=');
 const end=app.indexOf('function dsBuilderOdds(',start);
 assert.ok(start>0&&end>start,'country mapping must be self-contained');
 const code=app.slice(start,end)+";({dsCountry,dsNationalFlag,dsFlagHTML,dsLeagueHTML,dsCountryCodes})";
 const scope=vm.runInNewContext(code,{Intl,esc:x=>String(x)});
 assert.equal(scope.dsNationalFlag('England U21')[2],'gb-eng');
 assert.equal(scope.dsNationalFlag('Scotland')[2],'gb-sct');
 assert.equal(scope.dsNationalFlag('Wales')[2],'gb-wls');
 assert.equal(scope.dsNationalFlag('Northern Ireland')[2],'gb-nir');
 assert.equal(scope.dsNationalFlag('Bulgaria')[2],'bg');
 assert.equal(scope.dsNationalFlag('Serbia')[2],'rs');
 assert.equal(scope.dsNationalFlag('Tonga')[2],'to');
 assert.equal(scope.dsNationalFlag('FC Andorra'),null);
 assert.equal(scope.dsNationalFlag('Inter Miami'),null);
 assert.match(scope.dsLeagueHTML('Spain - LaLiga'),/\/flags\/es\.svg/);
 assert.match(scope.dsFlagHTML(scope.dsCountry('Scotland')),/\/flags\/gb-sct\.svg/);
});
test('world flag manifest lists all locally cached SVGs and non-country territory flags separately',()=>{
 const codes=JSON.parse(read('public/flags/codes.json'));
 const report=JSON.parse(read('public/flags/coverage.json'));
 assert.ok(Object.keys(codes).length>=160);
 assert.equal(codes.england,'gb-eng');
 assert.equal(codes.scotland,'gb-sct');
 assert.equal(codes.wales,'gb-wls');
 assert.equal(codes['northern ireland'],'gb-nir');
 assert.ok(report.total>=250,'whole-country SVG catalog should be available');
 assert.ok(report.resolved>=250);
 for(const code of [...new Set(Object.values(codes))]){
  assert.match(code,/^[a-z]{2}(?:-[a-z]{3})?$/);
  if(!report.unresolved.includes(code))assert.ok(existsSync(join(root,'public','flags',code+'.svg')),'flag missing: '+code);
 }
});

test('V27 match visibility, concise card and responsive archive contracts',()=>{
 const home=app.slice(app.indexOf('async function home(){'),app.indexOf('function ds27BuilderPicks('));
 const matches=app.slice(app.indexOf('async function matches(){'),app.indexOf('async function strategies(){'));
 const card=app.slice(app.indexOf('function groupedCard(g){'),app.indexOf('function bindFixtures()'));
 assert.doesNotMatch(home,/Всички селекции|api\('matches'/);
 assert.match(matches,/api\('strategies'\),api\('beta'\),api\('ten10'\)/);
 assert.match(matches,/iso\(p\.date\)>iso\(today\(\)\)/);
 assert.match(matches,/dsStrategyAccordion\(a,'Стратегии A–F · следващи дни'/);
 assert.match(matches,/dsStrategyAccordion\(b,'Beta Strategy · следващи дни'/);
 assert.match(matches,/dsStrategyAccordion\(c,'⭐ Всички 10\/10 · следващи дни'/);
 assert.match(card,/ds27Ratio/);
 assert.doesNotMatch(card,/Какво точно е записано|Оригинална селекция в OddAlerts|Не е посочено/);
 assert.match(css,/\.ds27-profile-grid/);
 assert.match(css,/\.ds27-archive-tabs/);
});
