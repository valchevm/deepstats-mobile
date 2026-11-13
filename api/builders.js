import {randomUUID} from 'node:crypto';
import {access,sheets,read,ensureBuilderSheet,BUILDER_SHEET,ID} from './_sheets.js';
export default async function handler(req,res){
 if(!['GET','POST'].includes(req.method))return res.status(405).end();
 if(!access(req,res))return;
 try{
  const s=await sheets();res.setHeader('Cache-Control','private, no-store');
  if(req.method==='GET'){
   // Do not create or change a sheet just to read history.
   const meta=await s.spreadsheets.get({spreadsheetId:ID,fields:'sheets.properties.title'});
   if(!meta.data.sheets?.some(x=>x.properties.title===BUILDER_SHEET))return res.json({builders:[]});
   const rows=await read(s,`'${BUILDER_SHEET}'!A2:H5000`);
   return res.json({builders:rows.filter(r=>r[0]).map(r=>({id:r[0],date:r[1],match:r[2],legs:JSON.parse(r[3]||'[]'),odds:r[4],createdAt:r[5],status:r[6],note:r[7]})).reverse()});
  }
  const b=req.body||{};
  if(typeof b.date!=='string'||!/^\d{2}\.\d{2}\.\d{4}$/.test(b.date)||typeof b.match!=='string'||b.match.length>180||!Array.isArray(b.legs)||b.legs.length<1||b.legs.length>20||b.legs.some(x=>typeof x.selection!=='string'||x.selection.length>300||!Number.isFinite(Number(x.odds))||Number(x.odds)<=1))return res.status(400).json({error:'Невалидни данни за билдъра.'});
  const legs=b.legs.map(x=>({selection:x.selection,odds:Number(x.odds)}));
  const odds=legs.reduce((a,x)=>a*x.odds,1);
  if(!Number.isFinite(odds)||odds>1e12)return res.status(400).json({error:'Невалиден общ коефициент.'});
  await ensureBuilderSheet(s);
  const id=randomUUID();const createdAt=new Date().toISOString();
  await s.spreadsheets.values.append({spreadsheetId:ID,range:`'${BUILDER_SHEET}'!A:H`,valueInputOption:'RAW',insertDataOption:'INSERT_ROWS',requestBody:{values:[[id,b.date,b.match,JSON.stringify(legs),odds.toFixed(4),createdAt,'Чака',String(b.note||'').slice(0,300)]]}});
  return res.status(201).json({id,odds,createdAt});
 }catch(e){console.error(e);return res.status(500).json({error:'Неуспешен запис. Проверете разрешенията към таблицата.'});}
}
