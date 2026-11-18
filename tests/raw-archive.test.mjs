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
  const size=Math.min(100,(payload.sheetId===1?201:1)-payload.start+1);
  return action==='batch'?{sheetId:payload.sheetId,start:payload.start,end:payload.start+size-1,count:size}:{verified:true,sheetId:payload.sheetId,start:payload.start,end:payload.start+size-1,rows:size};
 };
 assert.deepEqual(await archive({requestFn:req,log:()=>{}}),{day:'2026-11-18',sheets:2,rows:202,verified:true});
 assert.equal(calls.filter(x=>x[1]==='batch').length,4);assert.equal(calls.filter(x=>x[1]==='verify').length,4);
});
test('failed verification stops archival',async()=>{
 const req=async(method,action,payload)=>action==='preflight'?{ready:true}:action==='manifest'?{day:'2026-11-18',sheets:[{id:1,name:'A',rows:1,cols:1}]}:action==='batch'?{sheetId:1,start:1,end:1,count:1}:{verified:false};
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
