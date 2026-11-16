import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
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
test('one consistent Data Analytics B dashboard with three required sections',()=>{
 assert.match(app,/document\.documentElement\.dataset\.design='B'/);
 assert.doesNotMatch(app,/data-set-design="A"/);
 assert.doesNotMatch(app,/data-set-design="C"/);
 assert.match(app,/ds20BestBuilder\(buildersData\.proposals,dateLabel\)/);
 assert.match(app,/ds20StrategyWindow\(strategySelections\)/);
 assert.match(app,/Всички селекции/);
 assert.match(app,/<details class="ds20-details">/);
});
test('historical A-F Oracle panel lives in Statistics not the home fetch',()=>{
 assert.match(app,/strategyKeys=\['A','B','C','D1','D2','D3','E','F'\]/);
 assert.match(app,/async function statistics\(\)/);
 assert.match(app,/let historicalPanel=''/);
 assert.match(app,/ds19StatsPanel\(full\.selected,full,/);
 assert.match(app,/\$\{historicalPanel\}\$\{dates\(\)\}/);
 assert.doesNotMatch(app.slice(app.indexOf('async function home(){'),app.indexOf('async function matches(){')), /\/api\/oracle-stats/);
});
test('compact confidence and real crest folder are wired',()=>{
 assert.match(app,/ds20-confidence/);
 assert.match(app,/ds20-leg-crests/);
 assert.match(app,/fetch\('\/crests\/manifest\.json\?v=201'\)/);
 assert.match(css,/\.ds20-confidence/);
});
test('new scripts and styles share the same cache-busting versions',()=>{
 const appUrl=html.match(/\/app\.js\?v=\d+/)?.[0];
 const cssUrl=html.match(/\/style\.css\?v=\d+/)?.[0];
 assert.ok(appUrl&&cssUrl);
 assert.ok(sw.includes(appUrl));
 assert.ok(sw.includes(cssUrl));
 assert.match(sw,/deepstats-static-v29/);
});
test('existing Oracle and Sheets API source files are still referenced',()=>{
 assert.match(app,/api\('builders'/);
 assert.match(app,/api\('matches'/);
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
