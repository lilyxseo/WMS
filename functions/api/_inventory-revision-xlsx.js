const maxEntryBytes=64*1024*1024;
const textDecoder=new TextDecoder();
const normalize=value=>String(value??'').trim().normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
const sourceNames={
 stock:['Kartu Stock','Kartu Stok'],rpl:['Stok Retail','RPL'],bulky:['Stok Bulky','BULKY'],
 inbound:['Barang Masuk'],outbound:['Barang Keluar']
};
const fields={
 sku:['SKU','Kode Barang'],name:['Nama Barang','NamaBarang','Nama Produk'],location:['Lokasi Bulky','Lokasi','Lokasi Retail'],
 qty:['Qty','Quantity','Jumlah'],date:['Tanggal','Date'],from:['From','Dari'],to:['To','Tujuan'],
 status:['Status'],pic:['PIC'],note:['Keterangan']
};
const stockFields={sku:fields.sku,name:fields.name,location:fields.location,qty:['Stok Akhir','Stock Akhir','Saldo Akhir']};
const transactionFields=Object.fromEntries(Object.entries(fields).filter(([key])=>key!=='location'));

function openArchive(buffer){
 const bytes=new Uint8Array(buffer),view=new DataView(bytes.buffer),entries=new Map();
 let end=bytes.length-22;
 while(end>=0&&end>=bytes.length-65557&&view.getUint32(end,true)!==0x06054b50)end--;
 if(end<0||end<bytes.length-65557||view.getUint16(end+4,true)||view.getUint16(end+6,true))throw Error('File revisi XLSX tidak valid.');
 const count=view.getUint16(end+10,true);
 let offset=view.getUint32(end+16,true);
 if(count>4096)throw Error('Workbook revisi terlalu besar.');
 for(let index=0;index<count;index++){
  if(offset+46>bytes.length||view.getUint32(offset,true)!==0x02014b50)throw Error('Direktori revisi XLSX tidak valid.');
  const length=view.getUint16(offset+28,true),stop=offset+46+length;
  if(stop>bytes.length)throw Error('File revisi XLSX terpotong.');
  const name=textDecoder.decode(bytes.subarray(offset+46,stop));
  entries.set(name,{flags:view.getUint16(offset+8,true),method:view.getUint16(offset+10,true),
   size:view.getUint32(offset+20,true),plain:view.getUint32(offset+24,true),start:view.getUint32(offset+42,true)});
  offset=stop+view.getUint16(offset+30,true)+view.getUint16(offset+32,true);
 }
 return (name,optional=false)=>{
  const entry=entries.get(name);
  if(!entry&&optional)return null;
  if(!entry||entry.flags&1||entry.plain>maxEntryBytes||entry.start+30>bytes.length||view.getUint32(entry.start,true)!==0x04034b50)throw Error('Bagian revisi XLSX tidak dapat dibaca.');
  const start=entry.start+30+view.getUint16(entry.start+26,true)+view.getUint16(entry.start+28,true);
  if(start+entry.size>bytes.length)throw Error('File revisi XLSX terpotong.');
  const stream=new Blob([bytes.subarray(start,start+entry.size)]).stream();
  if(entry.method===8)return {stream:stream.pipeThrough(new DecompressionStream('deflate-raw')),size:entry.plain};
  if(entry.method===0)return {stream,size:entry.plain};
  throw Error('Kompresi revisi XLSX tidak didukung.');
 };
}

async function scan(open,name,handlers,optional=false){
 const entry=open(name,optional);
 if(!entry)return;
 const {SaxesParser}=await import('saxes');
 const parser=new SaxesParser({xmlns:true}),decoder=new TextDecoder();
 parser.on('doctype',()=>{throw Error('Deklarasi XML revisi tidak didukung.');});
 for(const [event,handle] of Object.entries(handlers))parser.on(event,handle);
 const reader=entry.stream.getReader();
 let size=0;
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   size+=value.length;
   if(size>entry.size||size>maxEntryBytes)throw Error('Bagian revisi XLSX melebihi batas.');
   parser.write(decoder.decode(value,{stream:true}));
  }
  if(size!==entry.size)throw Error('Bagian revisi XLSX terpotong.');
  parser.write(decoder.decode()).close();
 }finally{
  await reader.cancel().catch(()=>{});
  reader.releaseLock();
 }
}

const attr=(tag,name)=>tag.attributes[name]?.value;
function sheetPath(target){
 const parts=(target.startsWith('/')?target.slice(1):'xl/'+target).split('/');
 return parts.every(part=>part&&part!=='.'&&part!=='..')&&parts[0]==='xl'?parts.join('/'):'';
}
function column(ref){
 let number=0;
 for(const char of /^[A-Z]+/.exec(ref||'')?.[0]||'')number=number*26+char.charCodeAt(0)-64;
 return number-1;
}

export async function readInventoryRevision(buffer,{kind,query='',page=1,limit=50}){
 const open=openArchive(buffer);
 const sheets=[],links=new Map();
 let date1904=false;
 await scan(open,'xl/workbook.xml',{opentag:tag=>{
  if(tag.local==='workbookPr')date1904=['1','true'].includes(attr(tag,'date1904'));
  if(tag.local==='sheet')sheets.push({name:attr(tag,'name'),id:Object.values(tag.attributes).find(a=>a.local==='id')?.value});
 }});
 await scan(open,'xl/_rels/workbook.xml.rels',{opentag:tag=>{
  if(tag.local==='Relationship'&&attr(tag,'TargetMode')!=='External'&&attr(tag,'Type')?.endsWith('/worksheet')){
   links.set(attr(tag,'Id'),sheetPath(attr(tag,'Target')||''));
  }
 }});
 const names=sourceNames[kind].map(normalize);
 const tab=sheets.find(sheet=>names.includes(normalize(sheet.name)));
 const path=tab&&links.get(tab.id);
 if(!path)return null;

 const strings=[];
 let inString=false,inText=false,shared='';
 await scan(open,'xl/sharedStrings.xml',{
  opentag:tag=>{if(tag.local==='si'){inString=true;shared='';}if(tag.local==='t')inText=true;},
  text:value=>{if(inString&&inText)shared+=value;},
  closetag:tag=>{if(tag.local==='t')inText=false;if(tag.local==='si'){strings.push(shared);inString=false;}}
 },true);

 const custom=new Map(),formats=[];
 let inFormats=false;
 await scan(open,'xl/styles.xml',{opentag:tag=>{
  if(tag.local==='numFmt')custom.set(Number(attr(tag,'numFmtId')),attr(tag,'formatCode')||'');
  if(tag.local==='cellXfs')inFormats=true;
  if(tag.local==='xf'&&inFormats)formats.push(Number(attr(tag,'numFmtId')));
 },closetag:tag=>{if(tag.local==='cellXfs')inFormats=false;}},true);

 const stock=!['inbound','outbound'].includes(kind);
 const aliases=Object.entries(stock?stockFields:transactionFields).map(([key,labels])=>[key,labels.map(normalize)]);
 const required=stock?['sku','location','qty']:['date','sku','qty','from','to'];
 let columns=null,rowNumber=0,cells=new Map(),cell=null,readText=false,total=0;
 const rows=[],terms=query.toLowerCase().trim().split(/\s+/).filter(Boolean);
 function readCell(entry,field){
  if(!entry)return '';
  const {type,value,style}=entry;
  if(type==='s')return strings[Number(value)]??'';
  if(type==='b')return value==='1'?'TRUE':'FALSE';
  if(type==='d'&&field==='date')return value.slice(0,10);
  if(value===''||type&&type!=='n')return value;
  const number=Number(value);
  if(!Number.isFinite(number))return value;
  const format=custom.get(formats[style])||'';
  if(field==='sku'&&/^0{2,30}$/.test(format)&&Number.isInteger(number)&&number>=0)return value.padStart(format.length,'0');
  if(field==='date'&&number>=0&&number<2958466){
   return new Date((Math.floor(number)-(date1904?24107:25569))*86400000).toISOString().slice(0,10);
  }
  return field==='qty'?number:value;
 }
 await scan(open,path,{
  opentag:tag=>{
   if(tag.local==='row'){rowNumber++;cells=new Map();}
   if(tag.local==='c')cell={column:column(attr(tag,'r')),type:attr(tag,'t'),style:Number(attr(tag,'s')||0),value:''};
   if(tag.local==='v'||tag.local==='t'&&cell?.type==='inlineStr')readText=true;
  },
  text:value=>{if(cell&&readText)cell.value+=value;},
  closetag:tag=>{
   if(tag.local==='v'||tag.local==='t')readText=false;
   if(tag.local==='c'&&cell){if(cell.column>=0&&cell.column<256)cells.set(cell.column,cell);cell=null;}
   if(tag.local!=='row')return;
   if(!columns&&rowNumber<=100){
    const headers=new Map([...cells].map(([index,value])=>[normalize(readCell(value)),index]));
    const selectors=Object.fromEntries(aliases.map(([key,labels])=>[key,labels.map(label=>headers.get(label)).find(index=>index!==undefined)]));
    if(required.every(key=>selectors[key]!==undefined))columns=selectors;
    return;
   }
   if(!columns)return;
   const row=Object.fromEntries(aliases.map(([field])=>[field,readCell(cells.get(columns[field]),field)]));
   if(!String(row.sku).trim())return;
   if(stock)row.source=tab.name;
   const haystack=Object.values(row).join(' ').toLowerCase();
   if(!terms.every(term=>haystack.includes(term)))return;
   if(total>=(page-1)*limit&&rows.length<limit)rows.push(row);
   total++;
  }
 });
 if(!columns)return null;
 return {rows,total,sheet:tab.name};
}
