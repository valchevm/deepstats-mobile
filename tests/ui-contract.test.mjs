import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
test('concepts A B C render independently with persistent selection',()=>{
 for(const x of ['A','B','C'])assert.match(app,new RegExp('ds19-design-'+x));
 assert.match(app,/data-set-design="A"/);
 assert.match(app,/data-set-design="B"/);
 assert.match(app,/data-set-design="C"/);
 assert.match(app,/localStorage\.setItem\('ds-design'/);
});
test('home A-F stats read entire available Oracle history with explicit fallback',()=>{
 assert.match(app,/strategyKeys=\['A','B','C','D1','D2','D3','E','F'\]/);
 assert.match(app,/\/api\/oracle-stats\?sources='/);
 assert.match(app,/ds19SourceLabel/);
 assert.match(app,/sheets-fallback/);
 assert.match(app,/ds19StatsPanel\(x,st,groups,/);
});
test('new scripts and styles share the same cache-busting versions',()=>{
 const appUrl=html.match(/\/app\.js\?v=\d+/)?.[0];
 const cssUrl=html.match(/\/style\.css\?v=\d+/)?.[0];
 assert.ok(appUrl&&cssUrl);
 assert.ok(sw.includes(appUrl));
 assert.ok(sw.includes(cssUrl));
 assert.match(sw,/deepstats-static-v28/);
});
test('existing Oracle and Sheets API source files are still referenced',()=>{
 assert.match(app,/api\('dashboard'\)/);
 assert.match(app,/api\('matches'/);
 assert.match(app,/\/api\/history\?kind=/);
 assert.match(app,/api\('statistics'/);
});
