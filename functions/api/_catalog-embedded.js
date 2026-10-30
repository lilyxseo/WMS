import {CATALOG_ID,CATALOG_TABS} from './_catalog.js';
const LIMIT=32*1024*1024,PART_LIMIT=8*1024*1024,decoder=new TextDecoder();
const entity=text=>text.replace(/&(?:amp|lt|gt|quot|apos);/g,value=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[value]));
const attributes=text=>Object.fromEntries([...text.matchAll(/([\w:.-]+)\s*=\s*["']([^"']*)["']/g)].map(match=>[match[1],entity(match[2])]));
const elements=(xml,name)=>[...xml.matchAll(new RegExp('<(?:[\\w]+:)?'+name+'\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/(?:[\\w]+:)?'+name+'>)','g'))].map(match=>({attrs:attributes(match[1]),body:match[2]||''}));
const resolve=(base,target)=>{if(!target||target.includes('://'))return '';const parts=target.startsWith('/')?[]:base.split('/').slice(0,-1);for(const part of target.split('/')){if(part==='..'){if(!parts.length)return '';parts.pop();}else if(part&&part!=='.')parts.push(part);}return parts.join('/');};
const relPath=path=>path.replace(/([^/]+)$/,'_rels/$1.rels');
export async function boundedBytes(response,limit=LIMIT){if(Number(response.headers.get('content-length'))>limit)throw Error('Ekspor katalog terlalu besar.');const reader=response.body.getReader(),parts=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error('Ekspor katalog terlalu besar.');parts.push(value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;}
export async function catalogWorkbook(bytes){
 if(bytes.length>LIMIT||bytes.length<22)throw Error('Ekspor gambar tidak valid.');const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),entries=new Map();let end=-1;
 for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(view.getUint32(p,true)===0x06054b50){end=p;break;}if(end<0)throw Error('Ekspor gambar bukan XLSX.');let cursor=view.getUint32(end+16,true);const count=view.getUint16(end+10,true);if(count>10000||view.getUint16(end+4,true)||view.getUint16(end+6,true))throw Error('Ekspor gambar terlalu besar.');
 for(let n=0;n<count;n++){if(cursor+46>bytes.length||view.getUint32(cursor,true)!==0x02014b50)throw Error('Direktori gambar tidak valid.');const len=view.getUint16(cursor+28,true),extra=view.getUint16(cursor+30,true),comment=view.getUint16(cursor+32,true);if(cursor+46+len+extra+comment>bytes.length)throw Error('Direktori gambar terpotong.');const name=decoder.decode(bytes.subarray(cursor+46,cursor+46+len));entries.set(name,{size:view.getUint32(cursor+20,true),length:view.getUint32(cursor+24,true),method:view.getUint16(cursor+10,true),flags:view.getUint16(cursor+8,true),offset:view.getUint32(cursor+42,true)});cursor+=46+len+extra+comment;}
 const read=async path=>{const entry=entries.get(path);if(!entry)return null;if(entry.length>PART_LIMIT||entry.flags&1)throw Error('Bagian gambar terlalu besar.');const p=entry.offset;if(p+30>bytes.length||view.getUint32(p,true)!==0x04034b50)throw Error('Bagian gambar tidak valid.');const start=p+30+view.getUint16(p+26,true)+view.getUint16(p+28,true);if(start+entry.size>bytes.length)throw Error('Bagian gambar terpotong.');const compressed=bytes.subarray(start,start+entry.size);let result;if(entry.method===0)result=compressed;else if(entry.method===8)result=await boundedBytes(new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'))),PART_LIMIT);else throw Error('Kompresi gambar tidak didukung.');if(result.length!==entry.length)throw Error('Ukuran gambar tidak valid.');return result;};
 const xml=async path=>{const data=await read(path);const text=data?decoder.decode(data):'';if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('XML gambar tidak valid.');return text;};
 const links=async path=>new Map(elements(await xml(relPath(path)),'Relationship').filter(row=>row.attrs.TargetMode!=='External').map(row=>[row.attrs.Id,resolve(path,row.attrs.Target)]));
 const workbook='xl/workbook.xml',sheetLinks=await links(workbook),sheets=elements(await xml(workbook),'sheet'),images=new Map();
 const validMedia=path=>!!path&&entries.has(path)&&/\.(png|jpe?g|gif|webp)$/i.test(path);
 // Excel stores true in-cell images in value metadata and rich-data relationships,
 // independently of drawing anchors. vm indexes are 1-based; rich-value indexes are 0-based.
 const metadata=await xml('xl/metadata.xml'),types=elements(elements(metadata,'metadataTypes')[0]?.body||'','metadataType'),valueMetadata=elements(elements(metadata,'valueMetadata')[0]?.body||'','bk');
 const futureMetadata=new Map(elements(metadata,'futureMetadata').map(item=>[item.attrs.name,elements(item.body,'bk')]));
 const structures=elements(await xml('xl/richData/rdrichvaluestructure.xml'),'s'),richValues=elements(await xml('xl/richData/rdrichvalue.xml'),'rv');
 const richRels=await links('xl/richData/richValueRel.xml'),richImages=elements(await xml('xl/richData/richValueRel.xml'),'rel').map(item=>richRels.get(item.attrs['r:id']));
 const number=value=>/^\d+$/.test(String(value))?Number(value):NaN;
 const richImage=cell=>{const vm=number(cell.attrs.vm);if(!vm)return '';const block=valueMetadata[vm-1];if(!block)return '';
  for(const record of elements(block.body,'rc')){const type=types[number(record.attrs.t)-1];if(type?.attrs.name!=='XLRICHVALUE')continue;const future=futureMetadata.get(type.attrs.name)?.[number(record.attrs.v)],index=number(elements(future?.body||'','rvb')[0]?.attrs.i),value=richValues[index],structure=structures[number(value?.attrs.s)];if(structure?.attrs.t!=='_localImage')continue;const column=elements(structure.body,'k').findIndex(key=>key.attrs.n==='_rvRel:LocalImageIdentifier');if(column<0)continue;const relation=number(elements(value.body,'v')[column]?.body),image=richImages[relation];if(validMedia(image))return image;
  }return '';
 };
 // Some exporters use DISPIMG plus xl/cellimages.xml instead of rich data.
 const cellImageLinks=await links('xl/cellimages.xml'),cellImages=new Map();
 for(const image of elements(await xml('xl/cellimages.xml'),'cellImage')){const name=elements(image.body,'cNvPr')[0]?.attrs.name,media=cellImageLinks.get(elements(image.body,'blip')[0]?.attrs['r:embed']);if(name&&validMedia(media))cellImages.set(name,media);}

 for(const tab of CATALOG_TABS){const sheet=sheets.find(row=>row.attrs.name===tab.title);if(!sheet)continue;const path=sheetLinks.get(sheet.attrs['r:id']);if(!path)continue;const drawingLinks=await links(path),sheetXml=await xml(path);
  for(const cell of elements(sheetXml,'c')){const address=cell.attrs.r?.match(/^([A-Z]+)([1-9]\d*)$/);if(!address||address[1]!== (tab.key==='supplement'?'C':'B'))continue;const formula=entity(elements(cell.body,'f')[0]?.body||''),id=formula.match(/(?:^|\.)DISPIMG\(\s*"([^"]+)"/i)?.[1],image=richImage(cell)||cellImages.get(id);if(validMedia(image))images.set(tab.key+':'+address[2],image);}
  for(const drawing of elements(sheetXml,'drawing')){const drawingPath=drawingLinks.get(drawing.attrs['r:id']);if(!drawingPath)continue;const media=await links(drawingPath),drawingXml=await xml(drawingPath);
   for(const kind of ['oneCellAnchor','twoCellAnchor'])for(const anchor of elements(drawingXml,kind)){const from=elements(anchor.body,'from')[0]?.body||'',row=Number(elements(from,'row')[0]?.body),col=Number(elements(from,'col')[0]?.body);if(!Number.isInteger(row)||row<0||col!==(tab.key==='supplement'?2:1))continue;const blip=elements(anchor.body,'blip')[0],image=media.get(blip?.attrs['r:embed']);if(image&&entries.has(image)&&/\.(png|jpe?g|gif|webp)$/i.test(image)&&!images.has(tab.key+':'+(row+1)))images.set(tab.key+':'+(row+1),image);}
  }
 }
 return {images,read};
}
let memory;
export async function loadCatalogEmbedded(env,{fetchFn=fetch,getToken,cache=globalThis.caches?.default,now=Date.now()}={}){
 const version=Math.floor(now/300000),cacheKey=new Request('https://wms-catalog-cache.invalid/'+CATALOG_ID+'/'+version+'.xlsx');
 if(memory?.version===version)return memory.promise;
 const promise=(async()=>{let response=await cache?.match(cacheKey);if(!response){const token=await getToken(env);const options={headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)};response=await fetchFn('https://docs.google.com/spreadsheets/d/'+CATALOG_ID+'/export?format=xlsx',options);if([401,403,404].includes(response.status))response=await fetchFn('https://www.googleapis.com/drive/v3/files/'+CATALOG_ID+'/export?mimeType=application%2Fvnd.openxmlformats-officedocument.spreadsheetml.sheet',options);if(!response.ok)throw Error('Gambar tertanam belum dapat dibaca dari Google Drive.');const bytes=await boundedBytes(response);response=new Response(bytes,{headers:{'Cache-Control':'public,max-age=300'}});await cache?.put(cacheKey,response.clone());}
 return {...await catalogWorkbook(await boundedBytes(response)),version};})();memory={version,promise};try{return await promise;}catch(error){if(memory?.promise===promise)memory=null;throw error;}
}
export function catalogRaster(bytes){if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71)return 'image/png';if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';if(decoder.decode(bytes.subarray(0,6)).match(/^GIF8[79]a$/))return 'image/gif';if(decoder.decode(bytes.subarray(0,4))==='RIFF'&&decoder.decode(bytes.subarray(8,12))==='WEBP')return 'image/webp';return '';}
