const ZERO_WIDTH=/[\u200B-\u200D\u2060\uFEFF]/g;
const SMART_DASH=/[\u2010-\u2015\u2212]/g;
const ORDER={High:0,Medium:1,Low:2};

export function normalizeWarehouseLocation(value){let text=String(value??"");try{text=decodeURIComponent(text);}catch(_){text=text.replace(/%20/gi," ");}return text.normalize("NFKC").replace(ZERO_WIDTH,"").replace(SMART_DASH,"-").trim().toUpperCase().replace(/\s+/g," ").replace(/\s*-\s*/g,"-");}
export function normalizeProductName(value){return String(value??"").normalize("NFKC").replace(ZERO_WIDTH,"").trim().replace(/\s+/g," ").toUpperCase();}
export function validateWarehouseLocation(value,specialLocations=[]){
 const location=normalizeWarehouseLocation(value),specials=new Set(specialLocations.map(normalizeWarehouseLocation));
 if(!location)return {valid:false,location,issue:"Lokasi kosong.",recommendation:"Lengkapi lokasi transaksi sesuai lokasi gudang."};
 if(specials.has(location))return {valid:true,location,kind:"SPECIAL"};
 const retail=location.match(/^([A-Z]{2})-(\d+)-(\d+)-([A-Z])$/);
 if(retail){const [,zone,bay,level,position]=retail;if(!["AA","BB","CC","DD","EE","FF","GG","HH"].includes(zone))return invalid(location,`Zone Retail ${zone} tidak valid.`,"Zone Retail valid adalah AA–HH.");if(+bay<1||+bay>7)return invalid(location,`Nomor bay Retail ${bay} berada di luar range.`,"Bay Retail valid adalah 1–7.");if(+level<1||+level>3)return invalid(location,`Level Retail ${level} tidak valid.`,"Level Retail valid adalah 1–3.");const max=zone==="AA"?"H":"G";if(position<"A"||position>max)return invalid(location,`Position ${position} tidak valid untuk zone ${zone}.`,`Gunakan position A–${max}. Periksa kode lokasi transaksi.`);return {valid:true,location,kind:"RETAIL"};}
 const bulky=location.match(/^([A-H])(\d+)-(\d+)$/);
 if(bulky){const [,zone,rack,level]=bulky;if(rack.length!==2)return invalid(location,`Nomor rack Bulky ${rack} harus dua digit.`,"Gunakan rack Bulky 01–20, misalnya A01-2.");if(+rack<1||+rack>20)return invalid(location,`Nomor rack Bulky ${rack} berada di luar range.`,"Rack Bulky valid adalah 01–20.");if(+level<1||+level>5)return invalid(location,`Level Bulky ${level} tidak valid.`,"Level Bulky valid adalah 1–5.");return {valid:true,location,kind:"BULKY",zone};}
 return invalid(location,`Format lokasi ${location} tidak dikenali.`,"Periksa kode lokasi Retail, Bulky, atau lokasi khusus operasional.");
}
function invalid(location,issue,recommendation){return {valid:false,location,issue,recommendation};}
function raw(row,names){for(const name of names){const key=Object.keys(row||{}).find(k=>k.trim().toLowerCase()===name);if(key!==undefined)return row[key];}return "";}
function sku(row){return String(raw(row,["sku"])??"").replace(ZERO_WIDTH,"").trim();}function name(row){return String(raw(row,["nama barang","namabarang","nama","item","description"])??"").trim();}
// Lokasi harus diambil dari kolom lokasi milik masing-masing sheet. Kolom generik
// seperti AREA dapat berisi metadata proses (contoh: "UPDATE STOCK"), bukan alamat rak.
function location(row,source=""){
 const aliases=source==="Barang Keluar"?["from","lokasi bulky","lokasi","location","rak","bin"]:source==="Barang Masuk"?["to","lokasi bulky","lokasi","location","rak","bin"]:["lokasi bulky","lokasi","location","rak","bin"];
 return raw(row,aliases);
}
function qty(value){if(value===0||value==="0")return {valid:true,value:0};if(value===null||value===undefined||String(value).trim()==="")return {valid:false,value:0};const text=String(value).trim();if(!/^-?\d+(?:[.,]\d+)?$/.test(text))return {valid:false,value:0};const number=Number(text.replace(",","."));return {valid:Number.isFinite(number),value:number};}
function make(type,severity,row,source,issue,recommendation,detail={}){return {type,severity,sku:sku(row)||"-",nama:name(row)||"-",issue,source,recommendation,detail};}
export function deduplicateWarnings(rows){const seen=new Map();for(const row of rows){const key=row.fingerprint||[row.type||"",row.sku,row.source,row.detail?.rowId||"",row.detail?.location||"",row.issue,row.recommendation].join("::");if(!seen.has(key))seen.set(key,row);}return [...seen.values()].sort((a,b)=>(ORDER[a.severity]??9)-(ORDER[b.severity]??9));}
export function groupWarningsBySku(rows=[]){
 const grouped=new Map();
 for(const warning of deduplicateWarnings(rows)){
  const key=String(warning.sku||"-").normalize("NFKC").replace(ZERO_WIDTH,"").trim().toUpperCase();
  if(!grouped.has(key))grouped.set(key,{sku:warning.sku||"-",namaBarang:warning.nama||warning.namaBarang||"-",warnings:[]});
  const item=grouped.get(key);item.warnings.push(warning);if(item.namaBarang==="-"&&(warning.nama||warning.namaBarang))item.namaBarang=warning.nama||warning.namaBarang;
 }
 return [...grouped.values()].map(item=>{const warnings=[...item.warnings].sort((a,b)=>(ORDER[a.severity]??9)-(ORDER[b.severity]??9));return {...item,warnings,warningCount:warnings.length,highestSeverity:warnings[0]?.severity||"Low",sources:[...new Set(warnings.flatMap(w=>String(w.source||"").split(/\s*\/\s*/)).filter(Boolean))],types:[...new Set(warnings.map(w=>w.type||w.issue))]};}).sort((a,b)=>(ORDER[a.highestSeverity]??9)-(ORDER[b.highestSeverity]??9)||b.warningCount-a.warningCount||String(a.sku).localeCompare(String(b.sku)));
}
export function buildAdditionalWarnings({stock=[],outbound=[],inbound=[],rpl=[],bulky=[],specialLocations=[],sourcesSynchronized=false}={}){
 const warnings=[],all=[[stock,"Kartu Stock"],[inbound,"Barang Masuk"],[outbound,"Barang Keluar"],[rpl,"RPL"],[bulky,"BULKY"]],stockLocations=new Set();
 for(const row of stock){const loc=validateWarehouseLocation(location(row,"Kartu Stock"),specialLocations);if(loc.valid&&sku(row))stockLocations.add(`${sku(row).toUpperCase()}::${loc.location}`);}
 for(const [rows,source] of all)for(const row of rows){const rawLoc=location(row,source);if(String(rawLoc??"").trim()){const loc=validateWarehouseLocation(rawLoc,specialLocations);if(!loc.valid)warnings.push(make("INVALID_LOCATION","Medium",row,source,loc.issue,loc.recommendation,{location:loc.location,rawValue:String(rawLoc)}));else if(loc.location!==String(rawLoc).trim().toUpperCase())warnings.push(make("INPUT_FORMAT","Low",row,source,"Format lokasi dinormalisasi.","Standarkan spasi, encoding, dan tanda hubung pada sumber data.",{location:loc.location,rawValue:String(rawLoc),normalizedValue:loc.location}));else if(source==="Barang Keluar"&&stock.length&&sku(row)&&!stockLocations.has(`${sku(row).toUpperCase()}::${loc.location}`))warnings.push(make("SKU_NOT_IN_LOCATION","Medium",row,source,`Lokasi transaksi ${loc.location} perlu diverifikasi terhadap data stok yang tersedia.`,"Periksa FROM/lokasi transaksi atau posisi SKU pada Kartu Stok.",{location:loc.location,confidence:"Medium"}));}if(source==="Barang Masuk"||source==="Barang Keluar"){const parsed=qty(raw(row,["qty","quantity","jumlah"]));if(!parsed.valid)warnings.push(make("INPUT_FORMAT","Medium",row,source,"Format QTY tidak dapat digunakan.","Perbaiki QTY menjadi angka sebelum rekonsiliasi stok.",{rawValue:raw(row,["qty","quantity","jumlah"])}));}}
 // Kartu Stock is a location-level balance summary, not a transaction ledger.
 // Its PENGELUARAN bucket has no date, reference, destination, status, or movement
 // code that can link it to a Barang Keluar row. Comparing either aggregate (even
 // by SKU/location) therefore creates false positives when the bucket contains a
 // different reporting period or other stock movements. Do not reconcile these
 // sources until both expose a shared, event-level business key.
 const refs=new Map();for(const row of outbound){const q=qty(raw(row,["qty","quantity","jumlah"])),ref=String(raw(row,["no iseller","iseller","netsuite","no netsuite"])).trim();if(!ref||!q.valid)continue;const signature=[ref,sku(row),raw(row,["tanggal","date"]),q.value,normalizeWarehouseLocation(location(row,"Barang Keluar")),normalizeWarehouseLocation(raw(row,["to"]))].join("::");if(refs.has(signature))warnings.push(make("DUPLICATE_TRANSACTION","High",row,"Barang Keluar","Transaksi dengan reference ID yang sama ditemukan lebih dari sekali.","Verifikasi No iSeller/Netsuite dan hapus salah satu transaksi jika benar duplikat.",{referenceId:ref}));else refs.set(signature,row);}return deduplicateWarnings(warnings);
}
