export const CATALOG_ID='1ByrlcuWB4qWMOXJFdkqnpNrSwnBBQOUqEq1J3uiPAgE';
export const CATALOG_TABS=[{id:115543455,key:'main',title:'1. Product Catalog',label:'Product Catalog'},{id:1552864483,key:'supplement',title:'Jika tidak ada di katalog',label:'Pelengkap'}];
const text=value=>String(value??'').trim();
const key=value=>text(value).toLowerCase().replace(/[^a-z0-9]/g,'');
export function catalogImage(value){
 let raw=text(value);if(!raw)return '';const formula=raw.match(/^=IMAGE\(\s*"((?:[^"]|"")+)"/i);if(formula)raw=formula[1].replaceAll('""','"');
 if(!/^https:\/\//i.test(raw))return '';
 try{const url=new URL(raw);if(url.protocol!=='https:'||url.username||url.password)return '';if(url.hostname==='drive.google.com'){const id=url.pathname.match(/\/file\/d\/([\w-]+)/)?.[1]||url.searchParams.get('id');if(id&&/^[\w-]+$/.test(id))return 'https://drive.google.com/thumbnail?id='+encodeURIComponent(id)+'&sz=w800';}return url.href;}catch{return '';}
}
export function parseCatalog(rows,tab,formulaRows=[]){
 const names={sku:['itemid','sku','kodebarang'],name:['itemname','namabarang','productname'],parent:['itemparent','parent'],variant:['variant','varian'],note:['note','notes','catatan'],link:['linkimg','linkimage','imageurl','linkgambar'],picture:['picture','image','gambar']};
 let columns,header=-1;
 for(let i=0;i<Math.min(15,rows.length);i++){const keys=(rows[i]||[]).map(key),map=Object.fromEntries(Object.entries(names).map(([field,aliases])=>[field,keys.findIndex(value=>aliases.includes(value))]));if(map.name>=0&&(tab.key==='supplement'||map.sku>=0)){columns=map;header=i;break;}}
 if(header<0)throw Error('Header katalog tidak ditemukan di tab '+tab.title+'.');
 const products=[];
 for(let i=header+1;i<rows.length;i++){const row=rows[i]||[],get=field=>columns[field]<0?'':text(row[columns[field]]),sku=get('sku'),parent=get('parent'),variant=get('variant'),name=get('name')||[parent,variant].filter(Boolean).join(' ');if(!name&&!sku)continue;if(['itemname','namabarang','total','grandtotal'].includes(key(name))||['itemid','sku'].includes(key(sku)))continue;
 products.push({id:tab.id+':'+(i+1),source:tab.key,sourceRow:i+1,sku,name,parent,variant,note:get('note'),imageUrl:catalogImage(get('link'))||catalogImage(get('picture'))||catalogImage(formulaRows[i]?.[columns.link])||catalogImage(formulaRows[i]?.[columns.picture])});}
 return products;
}
