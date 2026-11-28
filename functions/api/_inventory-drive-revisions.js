const drive='https://www.googleapis.com/drive/v3/files/';
const xlsx='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const maxBytes=12*1024*1024;
const downloadHosts=new Set(['docs.google.com','drive.google.com','sheets.googleapis.com','www.googleapis.com','content.googleapis.com']);
const allowedDownload=url=>url.protocol==='https:'&&!url.username&&!url.password&&!url.port
 &&(downloadHosts.has(url.hostname)||url.hostname.endsWith('.googleusercontent.com'));

export class RevisionUnavailable extends Error {}

async function driveJson(fetchFn,url,token){
 const response=await fetchFn(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000),redirect:'error'});
 if(response.status===403||response.status===404)throw new RevisionUnavailable('Histori versi Google Drive tidak bisa diakses oleh akun WMS. Periksa izin spreadsheet dan cakupan OAuth Google Drive.');
 if(!response.ok)throw Error('Google Drive belum dapat membaca histori versi.');
 return response.json();
}

export async function findInventoryRevision(fetchFn,id,token,cutoff){
 const url=new URL(drive+encodeURIComponent(id)+'/revisions');
 url.searchParams.set('fields','nextPageToken,revisions(id,modifiedTime)');
 url.searchParams.set('pageSize','200');
 let chosen=null;
 for(let page=0;page<50;page++){
  const data=await driveJson(fetchFn,url.href,token);
  if(!Array.isArray(data.revisions)&&data.revisions!==undefined)throw Error('Daftar versi Google Drive tidak valid.');
  for(const revision of data.revisions||[]){
   const modified=Date.parse(revision.modifiedTime);
   if(typeof revision.id==='string'&&Number.isFinite(modified)&&modified<cutoff
    &&(!chosen||modified>Date.parse(chosen.modifiedTime)))chosen=revision;
  }
  if(!data.nextPageToken)return chosen;
  url.searchParams.set('pageToken',data.nextPageToken);
 }
 throw new RevisionUnavailable('Daftar versi terlalu panjang untuk memastikan versi yang sesuai.');
}

export async function downloadInventoryRevision(fetchFn,id,revision,token){
 const url=new URL(drive+encodeURIComponent(id)+'/revisions/'+encodeURIComponent(revision));
 url.searchParams.set('fields','id,exportLinks');
 const data=await driveJson(fetchFn,url.href,token);
 if(!data.exportLinks?.[xlsx])throw new RevisionUnavailable('Google Drive tidak menyediakan ekspor XLSX untuk versi spreadsheet ini.');
 let target=new URL(data.exportLinks[xlsx]),response;
 for(let hop=0;hop<=4;hop++){
  if(!allowedDownload(target))throw new RevisionUnavailable('Tautan ekspor versi Google Drive tidak didukung.');
  response=await fetchFn(target.href,{
   headers:downloadHosts.has(target.hostname)?{Authorization:`Bearer ${token}`}:undefined,
   redirect:'manual',signal:AbortSignal.timeout(20000)
  });
  if(![301,302,303,307,308].includes(response.status))break;
  const location=response.headers.get('location');
  await response.body?.cancel().catch(()=>{});
  if(!location||hop===4)throw new RevisionUnavailable('Unduhan versi spreadsheet tidak dapat diselesaikan.');
  target=new URL(location,target);
 }
 if(!response.ok||!response.body)throw new RevisionUnavailable('Versi spreadsheet ditemukan tetapi Google Drive belum mengizinkan unduhan.');
 if(Number(response.headers.get('content-length'))>maxBytes){
  await response.body.cancel().catch(()=>{});
  throw new RevisionUnavailable('Ukuran revisi melebihi batas unduhan.');
 }
 const reader=response.body.getReader(),chunks=[];
 let size=0;
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   size+=value.length;
   if(size>maxBytes)throw new RevisionUnavailable('Ukuran revisi melebihi batas unduhan.');
   chunks.push(value);
  }
 }finally{
  await reader.cancel().catch(()=>{});
  reader.releaseLock();
 }
 const bytes=new Uint8Array(size);
 let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return bytes.buffer;
}
