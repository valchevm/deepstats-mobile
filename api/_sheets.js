import {google} from 'googleapis';
const ID=process.env.SPREADSHEET_ID||'1iEufNQy8doCcfPA0LkHxPLvvXKiRKc60rH2dtyVx_oo';
export const BUILDER_SHEET='MOBILE_BUILDS';
export const HEADERS=['ID','Дата','Мач','Селекции JSON','Коефициент','Създаден на','Статус','Бележка'];
export function access(req,res){
  const expected=process.env.APP_ACCESS_TOKEN;
  if(!expected){res.status(503).json({error:'Липсва APP_ACCESS_TOKEN в настройките на Vercel.'});return false;}
  if(req.headers.authorization!==`Bearer ${expected}`){res.status(401).json({error:'Невалиден код за достъп.'});return false;}
  return true;
}
export async function sheets(){
 const email=process.env.GOOGLE_CLIENT_EMAIL;
 const key=process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g,'\n');
 if(!email||!key)throw new Error('Липсват Google service account credentials.');
 const auth=new google.auth.JWT({email,key,scopes:['https://www.googleapis.com/auth/spreadsheets']});
 return google.sheets({version:'v4',auth});
}
export async function read(s,range){const r=await s.spreadsheets.values.get({spreadsheetId:ID,range,valueRenderOption:'FORMATTED_VALUE'});return r.data.values||[];}
export async function ensureBuilderSheet(s){
 const meta=await s.spreadsheets.get({spreadsheetId:ID,fields:'sheets.properties.title'});
 if(!meta.data.sheets?.some(x=>x.properties.title===BUILDER_SHEET)){
   await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[{addSheet:{properties:{title:BUILDER_SHEET}}}]}});
   await s.spreadsheets.values.update({spreadsheetId:ID,range:`'${BUILDER_SHEET}'!A1:H1`,valueInputOption:'RAW',requestBody:{values:[HEADERS]}});
 }
}
export {ID};
