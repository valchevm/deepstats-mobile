import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
const api=readFileSync(new URL('../lib/_oracle_lossless.js',import.meta.url),'utf8');
const runner=readFileSync(new URL('../scripts/migrate-original-to-oracle.mjs',import.meta.url),'utf8');
test('original workbook is explicitly read-only and pinned',()=>{
 assert.match(api,/const SOURCE_ID='1iEufNQy8doCcfPA0LkHxPLvvXKiRKc60rH2dtyVx_oo'/);
 assert.match(api,/spreadsheets\.readonly/);
 assert.doesNotMatch(api,/\bDELETE FROM\b|\bTRUNCATE TABLE\b|spreadsheets\.values\.(update|clear|batchUpdate)\(/);
});
test('archive records values formulas original row and digest',()=>{
 for(const k of ['formatted','raw','formulas','ROW_SHA256','ROW_NUMBER','p_hash'])assert.ok(api.includes(k),k);
 assert.match(api,/if\(unverified\.length\)/);
});
test('import is manual and requires explicit confirmation',()=>{
 assert.match(runner,/MIGRATION_MODE==='live'/);
 assert.match(api,/MIGRATE_LOSSLESS_ORIGINAL/);
 assert.match(runner,/throw Error\('Non-empty count mismatch/);
});

test('Vercel Hobby deployment uses at most twelve API functions',()=>{
 const files=readdirSync(new URL('../api/',import.meta.url)).filter(name=>name.endsWith('.js'));
 assert.equal(files.length,12,'Every top-level API JS file is one Vercel function');
});
test('lossless handler is mounted on existing authenticated Oracle archive route',()=>{
 const router=readFileSync(new URL('../api/oracle-archive.js',import.meta.url),'utf8');
 assert.match(router,/import losslessImport from '\.\.\/lib\/_oracle_lossless\.js'/);
 assert.match(router,/if\(req\.query\.kind==='lossless'\)return losslessImport\(req,res\)/);
 assert.ok(router.indexOf("kind==='lossless'")<router.indexOf("req.method==='POST'"),'Dispatch before general POST archive handling');
 assert.match(runner,/api\/oracle-archive\?kind=lossless/);
 assert.doesNotMatch(runner,/api\/oracle-lossless-import/);
});
