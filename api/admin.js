import {randomBytes} from 'node:crypto';
import {admin,configured,db,hashCode} from './_subscription.js';
const validDate=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
export default async function handler(req,res){res.setHeader('Cache-Control','no-store');if(!admin(req))return res.status(403).json({error:'Нямате администраторски достъп.'});if(!configured())return res.status(503).json({error:'Добавете SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY и SESSION_SECRET.'});try{
if(req.method==='GET'){const rows=await db('ds_subscribers?select=id,name,status,expires_at,created_at&order=created_at.desc');return res.json({subscribers:rows})}
if(req.method!=='POST')return res.status(405).json({error:'Неподдържан метод'});
const action=req.body?.action;
if(action==='create'){const name=String(req.body.name||'').trim().slice(0,100);const days=Number(req.body.days);if(!name||!Number.isInteger(days)||days<1||days>3660)return res.status(400).json({error:'Невалидно име или срок.'});const code='DS-'+randomBytes(18).toString('hex').toUpperCase();const expires_at=new Date(Date.now()+days*86400000).toISOString();const rows=await db('ds_subscribers',{method:'POST',body:{name,code_hash:hashCode(code),status:'active',expires_at}});return res.json({subscriber:rows[0],code})}
if(action==='update'){const id=String(req.body.id||'');if(!/^[0-9a-f-]{36}$/i.test(id))return res.status(400).json({error:'Невалиден клиент.'});const patch={};if(['active','paused'].includes(req.body.status))patch.status=req.body.status;if(validDate(req.body.expires_at))patch.expires_at=new Date(req.body.expires_at).toISOString();if(!Object.keys(patch).length)return res.status(400).json({error:'Няма промени.'});const rows=await db('ds_subscribers?id=eq.'+id,{method:'PATCH',body:patch});return res.json({subscriber:rows[0]})}
return res.status(400).json({error:'Непознато действие.'})
}catch(e){return res.status(500).json({error:'Неуспешна операция. Проверете конфигурацията.'})}}
