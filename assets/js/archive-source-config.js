export const BUILTIN_ARCHIVE_SOURCES=[
 {key:'inventory',name:'Inventory',spreadsheetId:'1KzOcV1V4bcxfsLzhfwXxnIxxZoTRlKh4UYhNizREpCM'},
 {key:'kartu-stok-2025',name:'Kartu Stok 2025',spreadsheetId:'1D2El94SfeNglcEuBNqetVoCEROsINaMjvL6E85Ng7KU'}
];
export function archiveSpreadsheetId(value){
 const text=String(value??'').trim();let id=text;
 if(text.startsWith('https://')){try{const url=new URL(text);if(url.hostname!=='docs.google.com')throw Error();id=/^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(url.pathname)?.[1]||'';}catch{throw Error('Gunakan ID spreadsheet atau link Google Sheets yang valid.');}}
 if(!/^[A-Za-z0-9_-]{20,120}$/.test(id))throw Error('ID spreadsheet tidak valid.');return id;
}
export const archiveDeveloperRole=role=>/^(developer|mode development)$/i.test(String(role??'').trim());
