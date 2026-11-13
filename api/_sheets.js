import {subscription} from './_subscription.js';
import {google} from 'googleapis';
const ID=process.env.SPREADSHEET_ID||'1iEufNQy8doCcfPA0LkHxPLvvXKiRKc60rH2dtyVx_oo';
export async function access(req,res){return Boolean(await subscription(req,res));}
export async function sheets(){
 const email=process.env.GOOGLE_CLIENT_EMAIL;
 const key=process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g,'\n');
 if(!email||!key)throw new Error('Липсват Google service account credentials.');
 const auth=new google.auth.JWT({email,key,scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});
 return google.sheets({version:'v4',auth});
}
export async function read(s,range){const r=await s.spreadsheets.values.get({spreadsheetId:ID,range,valueRenderOption:'FORMATTED_VALUE'});return r.data.values||[];}
export {ID};
