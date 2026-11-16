#!/usr/bin/env python3
"""Cache real, exact-match club badges into public/crests/.

Sources: JoseArroyave/football-logos (MIT; SVGs organised by country)
the luukhopman/football-logos 2026/27 PNG directory and TheSportsDB fallback.
No fuzzy/non-unique matching.
Unresolved names are reported; generated shields are not official badges.
"""
import concurrent.futures
import json
import os
import re
import time
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "public" / "crests"
ROOT.mkdir(parents=True, exist_ok=True)
TEAMS = json.loads((ROOT / "teams.json").read_text(encoding="utf-8"))
MANIFEST_PATH = ROOT / "manifest.json"
existing = json.loads(MANIFEST_PATH.read_text(encoding="utf-8")) if MANIFEST_PATH.exists() else {}
TREE = "https://api.github.com/repos/JoseArroyave/football-logos/git/trees/main?recursive=1"
RAW = "https://raw.githubusercontent.com/JoseArroyave/football-logos/refs/heads/main/"
SECONDARY_TREE = "https://api.github.com/repos/luukhopman/football-logos/git/trees/master?recursive=1"
SECONDARY_RAW = "https://raw.githubusercontent.com/luukhopman/football-logos/refs/heads/master/"
HEADERS = {"User-Agent": "DeepStats-real-football-crest-cache/20", "Accept": "application/vnd.github+json"}
ALIASES = {
    "west ham united": "West Ham",
    "wrexham": "Wrexham AFC",
    "arsenal w": "Arsenal",
    "barcelona w": "Barcelona",
    "sl benfica w": "Benfica",
    "austria wien w": "Austria Wien",
    "nottingham forest u21": "Nottingham Forest",
    "strasbourg": "RC Strasbourg Alsace",
    "monaco": "AS Monaco",
    "new york rb": "New York Red Bulls",
    "new york city": "New York City FC",
    "inter club d'escaldes": "Inter Escaldes",
    "real oviedo": "Oviedo",
    "leicester city": "leicester",
    "bayer 04 leverkusen": "bayer leverkusen",
    "fc bayern münchen": "bayern munich",
    "fc augsburg": "augsburg",
    "sporting braga": "braga",
    "ac milan": "milan",
    "tsg hoffenheim": "hoffenheim",
    "fsv mainz 05": "mainz",
    "afc bournemouth": "bournemouth",
    "fc barcelona": "barcelona",
    "fc köbenhavn": "copenhagen",
    "psv": "psv eindhoven",
    "rb leipzig": "rb leipzig",
    "ferencvárosi": "ferencvaros",
    "nec nijmegen": "nec",
    "brighton & hove albion": "brighton & hove albion",
    "losc lille": "lille",
    "olympique marseille": "olympique de marseille",
    "fc köln": "1 fc koln",
    "paris saint germain": "paris saint-germain",
    "atlético de madrid": "atletico de madrid",
}

def norm(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    # Source SVG filenames contain underscores, which Python treats as word characters.
    s = s.replace("_", " ").replace("-", " ").replace(".", " ").replace("&", " and ")
    s = re.sub(r"\b(fc|cf|sc|fk|afc|ac|sv|gnk|rsc|kv|kvc|cd|rc|ca|sd|raal)\b", "", s)
    return re.sub(r"[^a-z0-9]+", "", s)

def slug(s):
    return re.sub(r"[^a-z0-9-]+", "", re.sub(r"\s+", "-", unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower())).strip("-") or "club"

def get(url, timeout=12):
    headers = dict(HEADERS)
    if url.startswith("https://api.github.com/") and os.environ.get("GITHUB_TOKEN"):
        headers["Authorization"] = "Bearer " + os.environ["GITHUB_TOKEN"]
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return response.read()

def valid_svg(raw):
    if len(raw) < 90 or len(raw) > 400000:
        return False
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return False
    if not root.tag.endswith("svg"):
        return False
    for element in root.iter():
        tag = element.tag.lower()
        if tag.endswith(("script", "foreignobject")):
            return False
        for key, value in element.attrib.items():
            k = key.lower()
            if k.startswith("on") or ("href" in k and value.strip().lower().startswith(("https:", "http:", "data:", "javascript:"))):
                return False
    return True

def index_svg():
    try:
        tree = json.loads(get(TREE, 25))
        if tree.get("truncated"):
            raise ValueError("GitHub tree truncated; refuse partial index")
        entries = {}
        for f in tree.get("tree", []):
            path = f.get("path", "")
            if f.get("type") != "blob" or not re.match(r"^logos/[^/]+/[^/]+\.svg$", path, re.I):
                continue
            key = norm(Path(path).stem)
            entries.setdefault(key, []).append(path)
        print("SVG index:", sum(map(len, entries.values())), "files")
        return entries
    except Exception as ex:
        print("SVG index unavailable:", str(ex)[:180])
        return {}

def index_png():
    try:
        tree = json.loads(get(SECONDARY_TREE, 25))
        if tree.get("truncated"):
            raise ValueError("PNG tree truncated")
        entries = {}
        for file in tree.get("tree", []):
            path = file.get("path", "")
            if file.get("type") != "blob" or not re.fullmatch(r"logos/[^/]+/[^/]+\.png", path, re.I):
                continue
            key = norm(Path(path).stem)
            entries.setdefault(key, []).append(path)
        print("Secondary PNG index:", sum(map(len, entries.values())), "files")
        return entries
    except Exception as ex:
        print("Secondary PNG index unavailable:", str(ex)[:180])
        return {}

def source_path(team, idx):
    choices = [team, ALIASES.get(team.casefold(), "")]
    for candidate in choices:
        if not candidate:
            continue
        matches = idx.get(norm(candidate), [])
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            exact = [p for p in matches if Path(p).stem.replace("_", " ").casefold() == candidate.casefold()]
            if len(exact) == 1:
                return exact[0]
    return None

def second_source(team, index):
    for candidate in [team, ALIASES.get(team.casefold(), "")]:
        if not candidate:
            continue
        paths = index.get(norm(candidate), [])
        # Do not silently pick a club when multiple leagues share the same name.
        if len(paths) != 1:
            continue
        url = SECONDARY_RAW + "/".join(urllib.parse.quote(p) for p in paths[0].split("/"))
        try:
            raw = get(url)
        except Exception:
            continue
        if raw.startswith(b"\x89PNG\r\n\x1a\n") and 100 <= len(raw) <= 400000:
            return raw
    return None

def sportsdb(team):
    names = [team, ALIASES.get(team.casefold(), "")]
    for name in names:
        if not name:
            continue
        try:
            data = json.loads(get("https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=" + urllib.parse.quote(name)))
        except Exception:
            continue
        matches = [r for r in data.get("teams") or [] if r.get("strSport") == "Soccer" and norm(r.get("strTeam")) == norm(name)]
        if len(matches) != 1:
            continue
        url = matches[0].get("strBadge", "")
        if not url.startswith("https://"):
            continue
        try:
            raw = get(url, 14)
        except Exception:
            continue
        ext = (".png" if raw.startswith(b"\x89PNG\r\n\x1a\n") else
               ".webp" if raw.startswith(b"RIFF") and b"WEBP" in raw[:16] else
               ".jpg" if raw.startswith(b"\xff\xd8\xff") else None)
        if ext and 100 <= len(raw) <= 400000:
            return raw, ext, "thesportsdb"
    return None

def one(team, index, png_index):
    key = team.casefold()
    previous = existing.get(key, "")
    if previous.startswith("/crests/") and (ROOT / Path(previous).name).is_file():
        return team, previous, "existing"
    path = source_path(team, index)
    if path:
        url = RAW + "/".join(urllib.parse.quote(p) for p in path.split("/"))
        try:
            raw = get(url)
            if valid_svg(raw):
                name = slug(team) + ".svg"
                (ROOT / name).write_bytes(raw)
                return team, "/crests/" + name, "github-svg"
        except Exception as ex:
            print("SVG failed:", team, str(ex)[:90])
    png = second_source(team, png_index)
    if png:
        name = slug(team) + '.png'
        (ROOT / name).write_bytes(png)
        return team, '/crests/' + name, 'github-2026-png'
    alt = sportsdb(team)
    if alt:
        raw, ext, provider = alt
        name = slug(team) + ext
        (ROOT / name).write_bytes(raw)
        return team, "/crests/" + name, provider
    return team, None, "unresolved"

def main():
    index = index_svg()
    png_index = index_png()
    done = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        tasks = [pool.submit(one, team, index, png_index) for team in TEAMS]
        for i, task in enumerate(concurrent.futures.as_completed(tasks), 1):
            team, path, source = task.result()
            done[team.casefold()] = path
            if i % 50 == 0:
                print("Processed", i, "of", len(TEAMS))
    manifest = {key: url for key, url in sorted(done.items()) if url}
    missing = sorted([team for team in TEAMS if not done.get(team.casefold())])
    # National teams use country flags, never count those as missing CLUB crests.
    try:
        nations=json.loads((ROOT.parent/"flags"/"codes.json").read_text(encoding="utf-8"))
        national_keys=set(n.casefold() for n in nations)
    except Exception:
        national_keys=set()
    nation_names=sorted(t for t in TEAMS if t.casefold() in national_keys)
    club_names=[t for t in TEAMS if t.casefold() not in national_keys]
    missing_clubs=sorted(t for t in missing if t.casefold() not in national_keys)
    (ROOT/"unresolved-clubs.json").write_text(json.dumps({"totalClubs":len(club_names),"resolvedClubBadges":len(club_names)-len(missing_clubs),"remainingClubs":missing_clubs,"reason":"No unambiguous, verified club badge from current public sources; national teams handled by flags","sources":["JoseArroyave/football-logos","luukhopman/football-logos","TheSportsDB"]},ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    (ROOT / "coverage.json").write_text(json.dumps({"total": len(TEAMS), "resolved": len(manifest), "unresolved": missing, "clubTotal": len(club_names), "clubResolved": len(club_names)-len(missing_clubs), "clubUnresolved": len(missing_clubs), "nationalTeamCount": len(nation_names), "source": "JoseArroyave SVG / luukhopman 2026-27 PNG / TheSportsDB; exact identity only"}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Real crests:", len(manifest), "/", len(TEAMS), "not verified:", len(missing))
    if missing:
        print("First unresolved:", ", ".join(missing[:35]))

if __name__ == "__main__":
    main()
