import {access} from './_sheets.js';
import oracledb from 'oracledb';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Diagnostic endpoint: never returns credentials, database names, or raw Oracle errors.
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  if(!access(req,res))return;
  const names=['ORACLE_USER','ORACLE_PASSWORD','ORACLE_CONNECT_STRING','ORACLE_WALLET_PEM','ORACLE_WALLET_PASSWORD'];
  const missing=names.filter(name=>!process.env[name]);
  if(missing.length)return res.status(503).json({connected:false,missing});
  let directory,connection;
  try {
    directory=await mkdtemp(join(tmpdir(),'deepstats-wallet-'));
    await writeFile(join(directory,'ewallet.pem'),process.env.ORACLE_WALLET_PEM,{mode:0o600});
    connection=await oracledb.getConnection({
      user:process.env.ORACLE_USER,
      password:process.env.ORACLE_PASSWORD,
      connectString:process.env.ORACLE_CONNECT_STRING,
      walletLocation:directory,
      walletPassword:process.env.ORACLE_WALLET_PASSWORD
    });
    const result=await connection.execute("SELECT COUNT(*) AS TOTAL FROM ADMIN.DS_MATCHES");
    return res.status(200).json({connected:true,canReadMatches:true,matchCount:Number(result.rows?.[0]?.[0]??0)});
  } catch(error) {
    console.error('Oracle diagnostic failure', {code:error.code||'CONNECTION_ERROR'});
    return res.status(503).json({connected:false,errorCode:error.code||'CONNECTION_ERROR'});
  } finally {
    if(connection)try{await connection.close()}catch{}
    if(directory)try{await rm(directory,{recursive:true,force:true})}catch{}
  }
}
