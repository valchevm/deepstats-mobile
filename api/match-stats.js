import {access,sheets,read} from './_sheets.js';
const clean=x=>String(x??'').trim().toLocaleLowerCase('bg-BG').replace(/[–—−]/g,'-').replace(/\s+/g,' ');
const iso=x=>{const s=String(x||'');if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;const m=s.match(/^(\d{2})[.\/-](\d{2})[.\/-](\d{4})$/);return m?m[3]+'-'+m[2]+'-'+m[1]:s};
export default async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 if(!access(req,res))return;
 const match=clean(req.query.match),date=iso(req.query.date),id=String(req.query.id||'').trim();
 if(!match&&!id)return res.status(400).json({error:'Липсва мач или Match ID'});
 try{
  const s=await sheets(),rows=await read(s,"'МАЧОВЕ JSON'!A2:K25000");
  const candidates=rows.filter(r=>r[7]&&(id&&String(r[4]||'').trim()===id||match&&clean(r[3])===match&&(!date||iso(r[0])===date)));
  if(!candidates.length)return res.status(404).json({error:'За този мач още няма налична статистика.'});
  const r=candidates[0];let data;
  try{data=JSON.parse(r[7])}catch{return res.status(422).json({error:'Невалиден JSON за избрания мач.'})}
  if(!data||typeof data.sections!=='object'||Array.isArray(data.sections))return res.status(422).json({error:'Липсват статистически раздели.'});
  res.setHeader('Cache-Control','private, max-age=60');
  return res.status(200).json({date:r[0],time:r[1],league:r[2],match:r[3],id:r[4],strategy:r[5],count:Number(r[6])||null,coverage:r[9],data});
 }catch(e){return res.status(500).json({error:'Неуспешно зареждане на статистиката.'})}
}
