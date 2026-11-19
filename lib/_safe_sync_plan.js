// Pure planning logic; runs without network or Google API dependencies.
const normalized=v=>v===null||v===undefined?'':String(v);
const same=(a,b)=>normalized(a)===normalized(b);
const formula=x=>typeof x==='string'&&x.startsWith('=');
const identity=(row,cols)=>cols.map(i=>normalized(row[i]).trim()).join('|');
const sheetIsSelection=t=>t.name==='СЕЛЕКЦИИ'||t.name==='АРХИВ BEST';
export function plan(source,target,tab,start){
 const writes=[],conflicts=[];
 for(let i=0;i<source.length;i++){
  const s=source[i],d=target[i],sr=start+i;
  if(s.every(x=>!normalized(x))&&d.every(x=>!normalized(x)))continue;
  const sk=identity(s,tab.key),dk=identity(d,tab.key);
  const skey=tab.key.every(c=>normalized(s[c]))&&sk;
  const dkey=tab.key.every(c=>normalized(d[c]))&&dk;
  if(skey&&dkey&&skey!==dkey){conflicts.push({row:sr,type:'ROW_IDENTITY_CHANGED'});continue}
  if(!skey&&dkey){conflicts.push({row:sr,type:'SOURCE_ROW_MISSING'});continue}
  if(!skey&&s.some(x=>normalized(x))&&d.some(x=>normalized(x))&&s.some((v,j)=>!same(v,d[j]))){
   conflicts.push({row:sr,type:'UNKEYED_ROW_CHANGED'});continue;
  }
  for(let j=0;j<tab.width;j++){
   const a=s[j],b=d[j];
   if(same(a,b))continue;
   if(formula(a)||formula(b)){conflicts.push({row:sr,col:j+1,type:'FORMULA_DIFFERENCE'});continue}
   if(!normalized(a)){conflicts.push({row:sr,col:j+1,type:'SOURCE_CLEAR_REQUIRES_REVIEW'});continue}
   if(!skey&&normalized(b)){conflicts.push({row:sr,col:j+1,type:'UNKEYED_OVERWRITE'});continue}
   // Preserve manually entered selections, results, and checkboxes in the new workbook.
   if(j===11&&sheetIsSelection(tab)){
    const previous=normalized(b).trim().toLowerCase();
    const next=normalized(a).trim().toLowerCase();
    const pending=v=>!v||v==='чака'||v==='pending';
    if(!pending(previous)&&previous!==next){conflicts.push({row:sr,col:j+1,type:'SETTLED_RESULT_CONFLICT'});continue}
   }
   if(j===12&&sheetIsSelection(tab)&&normalized(b)){
    conflicts.push({row:sr,col:j+1,type:'MANUAL_CHECKBOX_CONFLICT'});continue
   }
   writes.push({row:sr,col:j+1,value:a});
  }
 }
 return {writes,conflicts};
}
