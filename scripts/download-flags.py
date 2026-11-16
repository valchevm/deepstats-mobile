#!/usr/bin/env python3
"""Cache real flag-icons country SVG files, including England/Scotland/Wales.

Uses lipis/flag-icons: https://github.com/lipis/flag-icons (MIT license).
Only ISO/territory codes from public/flags/codes.json are downloaded.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import re
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]/"public"/"flags"
ROOT.mkdir(parents=True,exist_ok=True)
CODES=json.loads((ROOT/"codes.json").read_text(encoding="utf-8"))
SOURCE="https://raw.githubusercontent.com/lipis/flag-icons/main/flags/4x3/"
CODES_UNIQUE=sorted(set(CODES.values()))

def get_flag(code):
    if not re.fullmatch(r"[a-z]{2}(?:-[a-z]{3})?",code):
        return code,False,"bad-code"
    path=ROOT/(code+".svg")
    if path.is_file() and path.stat().st_size>100:
        return code,True,"existing"
    try:
        request=urllib.request.Request(SOURCE+code+".svg",headers={"User-Agent":"DeepStats-flags/21"})
        with urllib.request.urlopen(request,timeout=14) as response:
            data=response.read()
        if not 100<len(data)<150000:
            return code,False,"invalid-size"
        root=ET.fromstring(data)
        if not root.tag.endswith("svg"):
            return code,False,"not-svg"
        for elem in root.iter():
            if elem.tag.lower().endswith(("script","foreignobject")):
                return code,False,"unsafe-element"
            for key,value in elem.attrib.items():
                k=key.lower()
                if k.startswith("on") or ("href" in k and value.strip().lower().startswith(("http:","https:","data:","javascript:"))):
                    return code,False,"unsafe-attribute"
        path.write_bytes(data)
        return code,True,"downloaded"
    except Exception as ex:
        return code,False,type(ex).__name__

def main():
    results=[]
    with ThreadPoolExecutor(max_workers=12) as executor:
        for f in as_completed([executor.submit(get_flag,code) for code in CODES_UNIQUE]):
            results.append(f.result())
    missing=sorted(code for code,ok,reason in results if not ok)
    report={"total":len(CODES_UNIQUE),"resolved":len(CODES_UNIQUE)-len(missing),"unresolved":missing,"source":"lipis/flag-icons, 4x3 ISO SVG plus gb-eng/gb-sct/gb-wls/gb-nir","accuracy":"Only listed codes; missing files retain emoji fallback"}
    (ROOT/"coverage.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("Country flags:",report["resolved"],"/",report["total"],"missing:",missing)
    if report["resolved"]<10:
        raise RuntimeError("Too few flags resolved; check repository or upstream availability")

if __name__=="__main__":
    main()
