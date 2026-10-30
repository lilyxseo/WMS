import {CATALOG_ID} from './_catalog.js';
import {boundedBytes,catalogRasterStream} from './_catalog-image-data.js';
export const catalogName=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
export const cellImagesConfigured=env=>Boolean(env.CATALOG_CELL_IMAGES_URL||env.CATALOG_CELL_IMAGES_SECRET);
export function catalogGoogleImage(value){try{const url=new URL(value);return url.protocol==='https:'&&url.hostname.endsWith('.googleusercontent.com')&&!url.username&&!url.password&&!url.port&&url.href.length<=8192?url.href:'';}catch{return '';}}
let cached;
export async function loadCatalogCellImages(env,{fetchFn=fetch,now=Date.now()}={}){
 const endpoint=String(env.CATALOG_CELL_IMAGES_URL||''),secret=String(env.CATALOG_CELL_IMAGES_SECRET||'');
 let url;try{url=new URL(endpoint);}catch{throw Error('Konfigurasi pembaca gambar sel belum lengkap.');}
 if(url.origin!=='https://script.google.com'||!/^\/macros\/s\/[\w-]+\/exec$/.test(url.pathname)||url.search||url.hash||url.username||url.password||secret.length<32)throw Error('Konfigurasi pembaca gambar sel belum lengkap.');
 if(cached&&cached.endpoint===endpoint&&cached.secret===secret&&cached.expires>now)return cached.promise;
 const promise=(async()=>{
  let response=await fetchFn(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:secret}),redirect:'manual',signal:AbortSignal.timeout(45000)});
  if([302,303].includes(response.status)){const location=response.headers.get('location');let target;try{target=new URL(location);}catch{throw Error('Respons pembaca gambar sel tidak valid.');}if(target.origin!=='https://script.googleusercontent.com'||target.username||target.password)throw Error('Respons pembaca gambar sel tidak valid.');response=await fetchFn(target.href,{redirect:'error',signal:AbortSignal.timeout(45000)});}
  if(!response.ok)throw Error('Pembaca gambar sel belum dapat diakses.');
  let data;try{data=JSON.parse(new TextDecoder().decode(await boundedBytes(response,2*1024*1024)));}catch{throw Error('Respons pembaca gambar sel tidak valid.');}
  if(!data.success)throw Error(data.code==='UNAUTHORIZED'?'Kunci pembaca gambar sel tidak cocok.':'Pembaca gambar sel belum dapat membaca sheet.');
  if(data.spreadsheetId!==CATALOG_ID||data.sheetId!==1552864483||!Array.isArray(data.images))throw Error('Sumber gambar sel tidak sesuai KATALOG UPDATE.');
  const images=new Map();for(const image of data.images){const url=catalogGoogleImage(image.url);if(!Number.isInteger(image.row)||image.row<2||image.row>10000000||typeof image.name!=='string'||!image.name.trim()||!url||images.has(image.row))throw Error('Daftar gambar sel tidak valid.');images.set(image.row,{name:image.name,url});}
  return {images,version:Math.floor(now/120000)};
 })();cached={endpoint,secret,promise,expires:now+120000};try{return await promise;}catch(error){if(cached?.promise===promise)cached=null;throw error;}
}
export async function readCatalogCellImage(url,{fetchFn=fetch}={}){
 let target=catalogGoogleImage(url);if(!target)throw Error('Sumber gambar tidak valid.');
 for(let attempt=0;attempt<4;attempt++){const response=await fetchFn(target,{redirect:'manual',signal:AbortSignal.timeout(20000)});if([301,302,303,307,308].includes(response.status)){target=catalogGoogleImage(new URL(response.headers.get('location')||'',target).href);if(!target)throw Error('Sumber gambar tidak valid.');continue;}if(!response.ok)throw Error('Gambar sel belum dapat dimuat.');return catalogRasterStream(response);}
 throw Error('Gambar sel belum dapat dimuat.');
}
