// Preserve the complete identifier, including leading zeroes and SKU suffixes.
export function normalizeScanValue(value){
 let text=String(value??'').normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF]/g,'').trim();
 text=text.replace(/^\][A-Za-z][0-9]/,'').trim(); // AIM symbology identifier from handheld readers.
 if(/^https?:\/\//i.test(text)){
  try{const url=new URL(text),parameter=['sku','barcode'].map(key=>url.searchParams.get(key)).find(value=>value?.trim());
   if(parameter)text=parameter;else{const match=url.pathname.match(/\/sku\/([^/]+)\/?$/i);if(match)text=decodeURIComponent(match[1]);}
  }catch{}
 }else if(text.startsWith('{')){
  try{const data=JSON.parse(text),identifier=data?.sku??data?.barcode;if(typeof identifier==='string')text=identifier;}catch{}
 }
 return text.replace(/^(?:SKU|BARCODE)\s*:\s*/i,'').trim();
}
