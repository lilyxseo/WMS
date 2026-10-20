import {appendFile} from 'node:fs/promises';
const project=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(!project||!token)throw Error('Audit configuration unavailable');
const keysResponse=await fetch(`https://api.supabase.com/v1/projects/${project}/api-keys?reveal=true`,{headers:{Authorization:`Bearer ${token}`}});
if(!keysResponse.ok)throw Error('Audit credential unavailable');
const key=(await keysResponse.json()).find(item=>item.api_key?.startsWith('sb_secret_'))?.api_key;
const response=await fetch(`https://${project}.supabase.co/functions/v1/app-google-auth`,{method:'POST',headers:{apikey:key,'X-WMS-Server-Key':key}}),credentials=await response.json();
if(!response.ok||!credentials.access_token)throw Error('Google authentication unavailable');
const spreadsheet=process.env.BARANG_REJECT_SHEET_ID||'1BVGcIWnYqrG-DefzmnO_hZjNn3H3c4sriI7CBAWsxw8',report=[];
for(const tab of ['KARTU STOCK KST','Barang Masuk','Barang Keluar']){
 const range=`'${tab}'!A1:N20`,response=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet}/values/${encodeURIComponent(range)}?valueRenderOption=FORMULA`,{headers:{Authorization:`Bearer ${credentials.access_token}`}}),data=await response.json();
 if(!response.ok)throw Error('Reject source read failed');
 const rows=data.values||[],index=rows.findIndex(row=>row.some(cell=>String(cell).trim().toUpperCase()==='SKU'));
 report.push({tab,headerRow:index+1,headers:index<0?[]:rows[index],stockFormulaRows:tab==='KARTU STOCK KST'?rows.slice(index+1).filter(row=>String(row[3]||'').startsWith('=')).length:undefined});
}
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'report='+JSON.stringify(report)+'\n');
console.log('Read-only Reject header/formula audit completed. No stock records written or exported.');
