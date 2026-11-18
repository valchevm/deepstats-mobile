import test from 'node:test';
import assert from 'node:assert/strict';
import {request,archive,retry} from '../scripts/daily-raw-oracle-snapshot.mjs';
const fakeFetch=check=>async(url,options)=>{check(url,options);return {ok:true,status:200,text:async()=>JSON.stringify({ready:true})}};
test('GET preflight and manifest never send body',async()=>{
 for(const action of ['preflight','manifest'])await request('GET',action,{ignored:true},{base:'https://example.com',token:'test',fetcher:fakeFetch((url,options)=>{
  assert.equal(url,'https://example.com/api/oracle-archive?kind=raw-'+action);
  assert.equal(options.method,'GET');assert.equal(Object.hasOwn(options,'body'),false);
  assert.equal(options.headers['Content-Type'],undefined);
 })});
});
test('POST sends action and JSON payload',async()=>{
 await request('POST','batch',{day:'2026-11-18',sheetId:5,start:1},{base:'https://example.com',token:'test',fetcher:fakeFetch((url,options)=>{
  assert.equal(url,'https://example.com/api/oracle-archive');
  assert.equal(options.method,'POST');
  assert.deepEqual(JSON.parse(options.body),{day:'2026-11-18',sheetId:5,start:1,action:'batch'});
 })});
});
test('full archival checks all chunks and sheets',async()=>{
 const calls=[],req=async(method,action,payload)=>{
  calls.push([method,action,payload]);
  if(action==='preflight')return {ready:true,schema:'ADMIN.DS_RAW_SHEET_ROWS'};
  if(action==='manifest')return {day:'2026-11-18',sheets:[{id:1,name:'A',rows:201,cols:4},{id:2,name:'B',rows:1,cols:10}]};
  const size=Math.min(payload.size,(payload.sheetId===1?201:1)-payload.start+1);
  return action==='batch'?{sheetId:payload.sheetId,start:payload.start,end:payload.start+size-1,count:size}:calls.some(x=>x[1]==='batch'&&x[2].sheetId===payload.sheetId&&x[2].start===payload.start)?{verified:true,sheetId:payload.sheetId,start:payload.start,end:payload.start+size-1,rows:size}:(()=>{throw Object.assign(Error('unarchived'),{status:409})})();
 };
 assert.deepEqual(await archive({requestFn:req,log:()=>{}}),{day:'2026-11-18',sheets:2,rows:202,verified:true});
 assert.equal(calls.filter(x=>x[1]==='batch').length,2);assert.equal(calls.filter(x=>x[1]==='verify').length,4);
});
test('failed verification stops archival',async()=>{
 let hasWritten=false;
 const req=async(method,action,payload)=>action==='preflight'?{ready:true}:action==='manifest'?{day:'2026-11-18',sheets:[{id:1,name:'A',rows:1,cols:1}]}:action==='batch'?(hasWritten=true,{sheetId:1,start:1,end:1,count:1}):(hasWritten?{verified:false}:(()=>{throw Object.assign(Error('not yet saved'),{status:409})})());
 await assert.rejects(archive({requestFn:req,log:()=>{}}),/Oracle verification mismatch/);
});
test('permission errors fail immediately',async()=>{
 let n=0;const req=async()=>{n++;throw Object.assign(new Error('denied'),{status:503,errorCode:'ARCHIVE_SCHEMA_SETUP_REQUIRED'})};
 await assert.rejects(retry('GET','preflight',undefined,req),/denied/);assert.equal(n,1);
});

test('request timeout configuration allows longer than prior 14-second limit',async()=>{
 const source=(await import('node:fs/promises')).readFile;
 const runner=await source(new URL('../scripts/daily-raw-oracle-snapshot.mjs',import.meta.url),'utf8');
 assert.match(runner,/controller\.abort\(\),55000/);
});

test('raw Oracle SQL uses only stable, non-reserved named binds',async()=>{
 const src=await (await import('node:fs/promises')).readFile(new URL('../lib/_raw_snapshot.js',import.meta.url),'utf8');
 const sql=src.match(/const mergeSql=`([\s\S]*?)`;/)?.[1];
 assert.ok(sql,'MERGE SQL must exist');
 const placeholders=[...new Set([...sql.matchAll(/:([a-zA-Z][a-zA-Z_0-9]*)/g)].map(m=>m[1]))];
 assert.deepEqual(placeholders.sort(),['p_col_count','p_json_data','p_row_digest','p_row_index','p_sheet_key','p_sheet_title','p_snap_day'].sort());
 for(const bind of placeholders){
  assert.match(src,new RegExp('\\b'+bind+':'));
 }
 assert.doesNotMatch(sql,/:rowNum\\b|:raw\\b|:name\\b|:hash\\b|:row\\b/);
});

test('500-row chunks are resumed only after source-to-Oracle verification',async()=>{
 const actions=[];const requestFn=async(_method,action,payload)=>{
  actions.push({action,...payload});
  if(action==='preflight')return {ready:true};
  if(action==='manifest')return {day:'2026-11-18',sheets:[{id:7,name:'Big',rows:1000,cols:3}]};
  if(action==='verify'){
   if(payload.start===1)return {verified:true,sheetId:7,start:1,end:500,rows:500};
   if(!actions.some(x=>x.action==='batch'&&x.start===501))throw Object.assign(Error('missing'),{status:409});
   return {verified:true,sheetId:7,start:501,end:1000,rows:500};
  }
  return {sheetId:7,start:payload.start,end:payload.start+payload.size-1,count:payload.size};
 };
 const result=await archive({requestFn,log:()=>{}});
 assert.equal(result.rows,1000);assert.equal(actions.filter(x=>x.action==='batch').length,1);
 assert.equal(actions.find(x=>x.action==='batch').size,500);
});
test('failed 500-row write splits into smaller batches without claiming success',async()=>{
 const writes=[];
 const requestFn=async(_method,action,payload)=>{
  if(action==='preflight')return {ready:true};
  if(action==='manifest')return {day:'2026-11-18',sheets:[{id:7,name:'Big',rows:500,cols:3}]};
  if(action==='verify'){
   if(writes.some(x=>x.start===payload.start&&x.size===payload.size))return {verified:true,sheetId:7,start:payload.start,end:payload.start+payload.size-1,rows:payload.size};
   throw Object.assign(Error('missing'),{status:409});
  }
  if(payload.size===500)throw Object.assign(Error('slow'),{status:503});
  writes.push(payload);return {sheetId:7,start:payload.start,end:payload.start+payload.size-1,count:payload.size};
 };
 const result=await archive({requestFn,log:()=>{}});
 assert.equal(result.rows,500);assert.deepEqual(writes.map(x=>x.size),[250,250]);
});
