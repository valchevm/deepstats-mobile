/**
 * DeepStats seven-day archive — Google Apps Script.
 * Copy into Apps Script, run setupDeepStatsArchive() once, authorize.
 * SAFE MODE: archive and verify only. Never deletes or clears source rows.
 * Seven days means today and six previous calendar dates in Europe/Sofia.
 */
const DS_SOURCE_ID = '1iEufNQy8doCcfPA0LkHxPLvvXKiRKc60rH2dtyVx_oo';
const DS_ARCHIVE_ID = '1juZ5MOZXaH37ozlCaWIbGKJsmdL3eeofOEjNeiN8cNU';
const DS_TZ = 'Europe/Sofia';
const DS_RULES = [
  {source:'СЕЛЕКЦИИ', start:12, date:0, archive:'HISTORY_SELECTIONS'},
  {source:'СТРАТЕГИИ_ДАННИ', start:2, date:1, archive:'HISTORY_STRATEGIES'},
  {source:'ДАННИ', start:2, date:1, archive:'HISTORY_DATA_SELECTIONS',first:0,last:10},
  {source:'ДАННИ', start:2, date:12, archive:'HISTORY_DATA_BUILDERS',first:11,last:21},
  {source:'ДАННИ', start:2, date:23, archive:'HISTORY_DATA_EXTRA',first:22,last:45},
  {source:'ИСТОРИЯ КОЕФ.', start:2, date:1, archive:'HISTORY_ODDS'}
];
function dsDate(value) {
  if(value instanceof Date && !isNaN(value))return Utilities.formatDate(value,DS_TZ,'yyyy-MM-dd');
  const s=String(value||'').trim(),m=s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m?m[3]+'-'+m[2]+'-'+m[1]:/^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';
}
function dsCutoff() {
  const now=new Date(),today=Utilities.formatDate(now,DS_TZ,'yyyy-MM-dd');
  const midnight=new Date(today+'T12:00:00Z');
  midnight.setUTCDate(midnight.getUTCDate()-6);
  return Utilities.formatDate(midnight,DS_TZ,'yyyy-MM-dd');
}
function dsHash(row) {
  const bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(row));
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/,'');
}
function archiveDeepStatsSevenDays() {
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(30000))throw Error('Archive job already running');
  try {
    const source=SpreadsheetApp.openById(DS_SOURCE_ID),archive=SpreadsheetApp.openById(DS_ARCHIVE_ID);
    if(source.getId()===archive.getId())throw Error('Source and archive must differ');
    const cutoff=dsCutoff(),report=[];
    for(const rule of DS_RULES){
      const sheet=source.getSheetByName(rule.source);
      if(!sheet)throw Error('Missing source tab '+rule.source);
      const last=sheet.getLastRow(),width=rule.last!==undefined?rule.last-rule.first+1:sheet.getLastColumn();
      const first=rule.first||0,records=last>=rule.start?sheet.getRange(rule.start,first+1,last-rule.start+1,width).getDisplayValues():[];
      const dateIndex=rule.date-first;
      const older=records.map((row,i)=>({row,origin:rule.start+i,date:dsDate(row[dateIndex])})).filter(x=>x.date&&x.date<cutoff);
      let target=archive.getSheetByName(rule.archive);
      if(!target){target=archive.insertSheet(rule.archive);target.appendRow(['source_row','match_date','row_hash',...Array.from({length:width},(_,i)=>'column_'+(first+i+1))]);target.setFrozenRows(1)}
      const required=width+3;
      if(target.getMaxColumns()<required)target.insertColumnsAfter(target.getMaxColumns(),required-target.getMaxColumns());
      const n=target.getLastRow(),existing=n>1?target.getRange(2,1,n-1,3).getDisplayValues():[];
      const seen=new Set(existing.map(r=>r[0]+'|'+r[2]));
      const inserts=older.filter(x=>!seen.has(String(x.origin)+'|'+dsHash(x.row))).map(x=>[String(x.origin),x.date,dsHash(x.row),...x.row]);
      if(inserts.length){
        const start=target.getLastRow()+1;
        if(target.getMaxRows()<start+inserts.length-1)target.insertRowsAfter(target.getMaxRows(),start+inserts.length-1-target.getMaxRows());
        target.getRange(start,1,inserts.length,required).setValues(inserts);
        SpreadsheetApp.flush();
        const check=target.getRange(start,1,inserts.length,required).getDisplayValues();
        if(check.length!==inserts.length||check.some((r,i)=>r[2]!==inserts[i][2]))throw Error('Verification failed: '+rule.archive);
      }
      report.push({source:rule.source,archive:rule.archive,older:older.length,newRecords:inserts.length,cutoff});
    }
    PropertiesService.getScriptProperties().setProperty('DS_LAST_REPORT',JSON.stringify({at:new Date().toISOString(),report}));
    console.log(JSON.stringify(report));return report;
  }finally{lock.releaseLock()}
}
function setupDeepStatsArchive(){
  const name='archiveDeepStatsSevenDays';
  ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()===name).forEach(ScriptApp.deleteTrigger);
  ScriptApp.newTrigger(name).timeBased().everyDays(1).atHour(3).nearMinute(0).inTimezone(DS_TZ).create();
  return archiveDeepStatsSevenDays();
}
