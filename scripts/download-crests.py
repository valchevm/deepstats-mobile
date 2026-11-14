#!/usr/bin/env python3
"""Download verified football team badges into this repository on GitHub Actions."""
import json,re,time,unicodedata,urllib.parse,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]/'public'/'crests'
ROOT.mkdir(parents=True,exist_ok=True)
teams=json.loads((ROOT/'teams.json').read_text())
manifest=json.loads((ROOT/'manifest.json').read_text()) if (ROOT/'manifest.json').exists() else {}
def norm(s):
 return re.sub(r'[^a-z0-9]+','-',unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode().lower()).strip('-')
def get(url):
 req=urllib.request.Request(url,headers={'User-Agent':'DeepStats/12 (football badge archival)'})
 with urllib.request.urlopen(req,timeout=12) as r:return r.read()
ok=0;missing=0
for i,team in enumerate(teams):
 key=team.lower()
 if key in manifest and (ROOT/Path(manifest[key]).name).exists():continue
 try:
  url='https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t='+urllib.parse.quote(team)
  data=json.loads(get(url));found=None
  for t in data.get('teams') or []:
   if t.get('strSport')=='Soccer' and (t.get('strTeam') or '').casefold()==team.casefold():found=t;break
  if not found:missing+=1;continue
  badge=found.get('strBadge')
  if not badge or not badge.startswith('https://'):missing+=1;continue
  raw=get(badge)
  if len(raw)>400000 or len(raw)<100:missing+=1;continue
  ext='.png' if raw[:8]==b'\x89PNG\r\n\x1a\n' else '.webp' if raw[:4]==b'RIFF' else '.jpg' if raw[:3]==b'\xff\xd8\xff' else None
  if not ext:missing+=1;continue
  filename=norm(team)+ext
  (ROOT/filename).write_bytes(raw)
  manifest[key]='/crests/'+filename
  ok+=1
 except Exception as e:print('Skip',team,str(e)[:80]);missing+=1
 if i%30==0:print('Checked',i,'/',len(teams),'saved',ok)
 time.sleep(.2)
(ROOT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2,sort_keys=True)+'\n')
print('New',ok,'unresolved',missing,'total',len(manifest))
