import {access,sheets,read} from './_sheets.js';
export default async function handler(req,res){
 if(req.method!=='GET')return res.status(405).end();
 if(!access(req,res))return;
 try{
  const s=await sheets();const kind=String(req.query.kind||'dashboard');
  res.setHeader('Cache-Control','private, no-store');
  if(kind==='dashboard'){
   const [stats,best,strategies]=await Promise.all([read(s,"'СТАТИСТИКА'!A4:F18"),read(s,"'СЕЛЕКЦИИ'!A1:O8"),read(s,"'ДНЕВЕН ЦЕНТЪР'!M2:R14")]);
   const metrics={};for(const r of stats.slice(1))if(r[0])metrics[r[0]]={selections:r[1]||'',builders:r[3]||'',total:r[5]||''};
   const picks=best.slice(2).filter(r=>r[3]&&r[4]).map((r,i)=>({id:`best-${i}`,date:r[0],time:r[1],league:r[2],match:r[3],selection:r[4],odds:r[9],level:r[10],result:r[11],source:'BEST'}));
   return res.json({metrics,picks,strategies:strategies.filter(r=>r[0]),updatedAt:new Date().toISOString()});
  }
  if(kind==='matches'){
   const rows=await read(s,"'СЕЛЕКЦИИ'!A11:O12000");
   const date=String(req.query.date||'');if(!/^\d{2}\.\d{2}\.\d{4}$/.test(date))return res.status(400).json({error:'Избери дата във формат ДД.ММ.ГГГГ.'});
   const picks=rows.filter(r=>String(r[0]||'').trim()===date&&r[3]&&r[4]).map((r,i)=>({id:`${date}-${i}`,date:r[0],time:r[1],league:r[2],match:r[3],selection:r[4],odds:r[9],level:r[10],result:r[11],matchId:r[14]}));
   return res.json({picks,date});
  }
  if(kind==='history'){
   const date=String(req.query.date||'');if(!/^\d{2}\.\d{2}\.\d{4}$/.test(date))return res.status(400).json({error:'Невалидна дата.'});
   const rows=await read(s,"'АРХИВ BEST'!A1:O15000");
   const picks=rows.filter(r=>r.some(c=>String(c||'').includes(date))).slice(0,250);
   return res.json({date,rows:picks});
  }
  if(kind==='strategies'){
   const [summary,rows]=await Promise.all([read(s,"'ДНЕВЕН ЦЕНТЪР'!M2:R14"),read(s,"'СТРАТЕГИИ'!A1:H32")]);
   return res.json({summary:summary.filter(r=>r[0]),details:rows});
  }
  return res.status(400).json({error:'Непозната заявка.'});
 }catch(e){console.error(e);return res.status(500).json({error:'Неуспешна връзка с Google Sheets. Проверете настройките и споделянето.'});}
}
