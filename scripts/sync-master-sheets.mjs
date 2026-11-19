/**
 * Sync only original source columns from three master tabs into the new DeepStats workbook.
 * This is independent from the Oracle archive. The old workbook is strictly read-only.
 * Uses the same Google service-account credentials as the site; the new workbook must
 * be explicitly shared with that service-account email as Editor before live writes.
 *
 * DRY_RUN=1 prints planned changes and never writes.
 */
import {google} from 'googleapis';
import {createHash} from 'node:crypto';

const SOURCE='1iEufNQy8doCcfPA0LkHxPLvvXKiRKc60rH2dtyVx_oo';
const TARGET='1yckF0vx9X1fido2pmTsp2i5BVVLCZ5TG32JCOseSBv8';
const TABS=[
  {name:'СЕЛЕКЦИИ',cols:'Z',width:26},
  {name:'АРХИВ BEST',cols:'AY',width:51},
  {name:'МАЧОВЕ JSON',cols:'K',width:11}
];
const MAX_UPDATE_ROWS=40;
const QUOTE=s=>"'"+s.replaceAll("'","''")+"'";
const blank=v=>v===undefined||v===null?'':v;
const normalize=row=>row.map(blank);
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,16);
function equal(a,b){return JSON.stringify(normalize(a))===JSON.stringify(normalize(b))}
async function main(){
  const dry=process.env.DRY_RUN!=='0';
  if(SOURCE===TARGET)throw new Error('Refusing to sync source to itself');
  const email=process.env.GOOGLE_CLIENT_EMAIL;
  const key=process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g,'\n');
  if(!email||!key)throw new Error('Missing Google credentials');
  const auth=new google.auth.JWT({email,key,scopes:['https://www.googleapis.com/auth/spreadsheets']});
  const api=google.sheets({version:'v4',auth});
  const [srcMeta,dstMeta]=await Promise.all([
    api.spreadsheets.get({spreadsheetId:SOURCE,fields:'spreadsheetId,sheets(properties(title,gridProperties))'}),
    api.spreadsheets.get({spreadsheetId:TARGET,fields:'spreadsheetId,sheets(properties(title,gridProperties))'})
  ]);
  const src=new Map(srcMeta.data.sheets.map(x=>[x.properties.title,x.properties]));
  const dst=new Map(dstMeta.data.sheets.map(x=>[x.properties.title,x.properties]));
  const report=[];
  for(const tab of TABS){
    const a=src.get(tab.name),b=dst.get(tab.name);
    if(!a||!b)throw Error('Missing tab '+tab.name);
    if(a.gridProperties.columnCount<tab.width||b.gridProperties.columnCount<tab.width)
      throw Error('Source/destination columns too short: '+tab.name);
    if(b.gridProperties.rowCount<a.gridProperties.rowCount)
      throw Error('Destination requires '+a.gridProperties.rowCount+' rows in '+tab.name+'; refusing partial sync');
    // FORMULA returns the original formulas for formula cells, instead of values.
    // It also preserves boolean checkboxes and date serials.
    const range=QUOTE(tab.name)+'!A1:'+tab.cols+a.gridProperties.rowCount;
    const [sr,dr]=await Promise.all([
      api.spreadsheets.values.get({spreadsheetId:SOURCE,range,valueRenderOption:'FORMULA'}),
      api.spreadsheets.values.get({spreadsheetId:TARGET,range,valueRenderOption:'FORMULA'})
    ]);
    const sourceRows=sr.data.values||[],targetRows=dr.data.values||[];
    if(targetRows.length>sourceRows.length)
      throw Error('Destination has additional rows in '+tab.name+'. Manual reconciliation required; no deletes are allowed.');
    const changed=[];
    for(let i=0;i<sourceRows.length;i++)if(!equal(sourceRows[i],targetRows[i])){
      // Never clear cells in the source area as a side effect of a sparse update.
      // Update the whole original-column rectangle for this changed row.
      changed.push(i);
    }
    let written=0;
    if(!dry){
      // Group contiguous row changes, with bounded request sizes and an immediate read-back audit.
      for(let pos=0;pos<changed.length;){
        let end=pos+1;
        while(end<changed.length&&changed[end]===changed[end-1]+1&&end-pos<MAX_UPDATE_ROWS)end++;
        const startIndex=changed[pos],lastIndex=changed[end-1],start=startIndex+1;
        const data=sourceRows.slice(startIndex,lastIndex+1).map(row=>
          Array.from({length:tab.width},(_,j)=>blank(row[j])));
        await api.spreadsheets.values.update({
          spreadsheetId:TARGET,range:QUOTE(tab.name)+'!A'+start+':'+tab.cols+(lastIndex+1),
          valueInputOption:'USER_ENTERED',requestBody:{majorDimension:'ROWS',values:data}
        });
        const check=await api.spreadsheets.values.get({
          spreadsheetId:TARGET,range:QUOTE(tab.name)+'!A'+start+':'+tab.cols+(lastIndex+1),
          valueRenderOption:'FORMULA'
        });
        const verified=check.data.values||[];
        for(let i=0;i<data.length;i++)if(!equal(data[i],verified[i]||[]))
          throw Error('Readback mismatch '+tab.name+' row '+(start+i)+'; inspect before re-running.');
        written+=data.length;pos=end;
      }
    }
    report.push({tab:tab.name,sourceRows:sourceRows.length,changedRows:changed.length,
      writtenRows:written,sourceHash:hash(sourceRows),mode:dry?'DRY_RUN':'LIVE'});
    console.log(JSON.stringify(report.at(-1)));
  }
  console.log('SYNC '+(dry?'PREVIEW':'VERIFIED')+' '+JSON.stringify(report));
}
main().catch(e=>{console.error('SYNC FAILED:',e?.message||e);process.exitCode=1});
