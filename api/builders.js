export default function handler(req,res){res.setHeader('Allow','GET');return res.status(410).json({error:'Записът на билдъри в Google Sheets е изключен. Билдърите се пазят само на устройството.'});}
