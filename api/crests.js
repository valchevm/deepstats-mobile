const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(fc|cf|sc|fk|ac|club|football)\b/g,'').replace(/[^a-z0-9]/g,'');
export default async function handler(req,res){
 if(req.method!=='GET')return res.status(405).end();
 const team=String(req.query.team||'').trim().slice(0,100);if(!team)return res.status(400).json({error:'Missing team'});
 res.setHeader('Cache-Control','public, s-maxage=86400, stale-while-revalidate=604800');
 const variants=[team,team.replace(/\s+(FC|CF|SC|FK|AC)$/i,''),team.replace(/^(FC|CF|SC|FK|AC)\s+/i,'')].filter((v,i,a)=>v&&a.indexOf(v)===i);
 for(const name of variants){try{const url='https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t='+encodeURIComponent(name);const response=await fetch(url,{signal:AbortSignal.timeout(6500)});if(!response.ok)continue;const data=await response.json();const teams=(data.teams||[]).filter(t=>t.strSport==='Soccer'&&/^https:\/\//.test(t.strBadge||''));const found=teams.find(t=>normalize(t.strTeam)===normalize(team)||normalize(t.strTeam)===normalize(name));if(found)return res.json({url:found.strBadge,team:found.strTeam})}catch(e){console.error('Crest lookup:',String(e.message).slice(0,90))}}
 return res.json({url:null,team});
}
