import {getGoogleAccessToken} from '../_google-auth.js';
import {getNoteIdentity} from '../_note-identity.js';
export const ASSET_ID='1uYIE_St-w1_VLyqSpTdvrThZToJnSkRdTuSMRaWnHyE';
const json=(body,status=200)=>Response.json(body,{status});
export function columnName(n){let out='';for(n++;n>0;n=Math.floor((n-1)/26))out=String.fromCharCode(65+(n-1)%26)+out;return out;}
export async function onRequest({request,env}){
 if(!['POST','PATCH','DELETE'].includes(request.method))return json({success:false,message:'Method not allowed'},405);
 const action={POST:'CREATE',PATCH:'UPDATE',DELETE:'DELETE'}[request.method];
 try{
  const identity=await getNoteIdentity(request,env);
  if(!identity)return json({success:false,message:'Silakan login kembali.'},401);
  if(!identity.id.startsWith('developer:')&&!identity.role.toLowerCase().includes('pic'))return json({success:false,message:'Hanya PIC atau Developer yang bisa mengubah Asset Store.'},403);
  const body=await request.json();const sheet=String(body.sheetName||'');
  if(!sheet||sheet.length>100||!sheet.toLowerCase().includes('asset'))return json({success:false,message:'Sheet Asset tidak valid'},400);
  const access=await getGoogleAccessToken(env);
  const base=`https://sheets.googleapis.com/v4/spreadsheets/${ASSET_ID}`;
  async function google(path,method='GET',payload){const res=await fetch(base+path,{method,headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},body:payload===undefined?undefined:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});const data=await res.json().catch(()=>({}));if(!res.ok)throw Error('Google Sheets gagal memproses permintaan. Periksa data sebelum mencoba lagi.');return data;}
  const meta=await google('?fields=sheets.properties');
  const properties=meta.sheets?.find(s=>s.properties?.title===sheet)?.properties;
  if(!properties)return json({success:false,message:'Sheet Asset tidak ditemukan'},400);
  const quoted=`'${sheet.replaceAll("'","''")}'`;
  const header=(await google(`/values/${encodeURIComponent(quoted+'!1:1')}`)).values?.[0]||[];
  if(!header.length||!header.some(v=>String(v).trim())||header.length>702||new Set(header.map((h,i)=>String(h||'').trim()||`Column ${i+1}`)).size!==header.length)return json({success:false,message:'Header sheet tidak valid'},400);
  if(JSON.stringify(body.columns)!==JSON.stringify(header.map((h,i)=>String(h||'').trim()||`Column ${i+1}`)))return json({success:false,message:'Kolom berubah. Refresh data sebelum menyimpan.'},409);
  let range,current=[];
  if(request.method!=='POST'){
   if(!Number.isInteger(body.rowNumber)||body.rowNumber<2||body.rowNumber>properties.gridProperties.rowCount)return json({success:false,message:'Baris tidak valid'},400);
   range=quoted+'!A'+body.rowNumber+':'+columnName(header.length-1)+body.rowNumber;
   current=(await google(`/values/${encodeURIComponent(range)}?valueRenderOption=FORMULA`)).values?.[0]||[];
   const displayed=(await google(`/values/${encodeURIComponent(range)}`)).values?.[0]||[];
   if(!Array.isArray(body.expected)||body.expected.length!==header.length||body.expected.some((v,i)=>String(v??'')!==String(displayed[i]??'')))return json({success:false,message:'Data telah berubah. Refresh lalu edit ulang.'},409);
   if(request.method==='DELETE'&&current.some(v=>typeof v==='string'&&v.startsWith('=')))return json({success:false,message:'Baris berisi formula. Edit melalui spreadsheet agar formula tetap aman.'},409);
  }
  if(request.method==='DELETE')await google(`/values/${encodeURIComponent(range)}:clear`,'POST',{});
  else{
   if(!Array.isArray(body.values)||body.values.length!==header.length||body.values.some(v=>typeof v!=='string'||v.length>10000)||!body.values.some(v=>v.trim()))return json({success:false,message:'Isi minimal satu kolom; setiap nilai maksimal 10000 karakter.'},400);
   const values=body.values.map((value,i)=>/^(qty|quantity|jumlah|harga|nilai)$/i.test(String(header[i]).trim())&&value.trim()!==''&&Number.isFinite(Number(value))?Number(value):value);
   if(request.method==='POST')await google(`/values/${encodeURIComponent(quoted+'!A:'+columnName(header.length-1))}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,'POST',{values:[values]});
   else {
    const changed=values.map((value,i)=>({value,i})).filter(({i})=>String(body.values[i])!==String(body.expected[i]));
    if(changed.some(({i})=>typeof current[i]==='string'&&current[i].startsWith('=')))return json({success:false,message:'Kolom formula tidak dapat diubah. Biarkan nilainya seperti semula.'},409);
    if(changed.length)await google('/values:batchUpdate','POST',{valueInputOption:'RAW',data:changed.map(({i,value})=>({range:quoted+'!'+columnName(i)+body.rowNumber,values:[[value]]}))});
   }
  }
  return json({success:true,message:'Data Asset berhasil '+(action==='CREATE'?'ditambahkan':action==='DELETE'?'dihapus':'diperbarui')});
 }catch(error){return json({success:false,message:error.message||'Penyimpanan gagal. Periksa spreadsheet sebelum mengulang.'},502);}
}
