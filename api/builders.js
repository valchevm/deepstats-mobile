export default function handler(req,res){res.setHeader('Allow','GET');return res.status(405).json({error:'Функцията е само за преглед.'});}
