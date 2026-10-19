// Asset edits require a server-verified header and the complete original row.
// The former client-selected spreadsheet/column endpoint is retired.
export function onRequest(){return Response.json({success:false,message:'Gunakan form edit Asset Store terbaru.'},{status:405});}
