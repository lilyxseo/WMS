// Standalone Apps Script: reads the source spreadsheet without changing it.
const WMS_CATALOG_ID = '1ByrlcuWB4qWMOXJFdkqnpNrSwnBBQOUqEq1J3uiPAgE';
const WMS_CATALOG_SHEET_ID = 1552864483;
function catalogJson_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
function doGet() { return catalogJson_({success:false,code:'POST_REQUIRED'}); }
function doPost(event) {
  try {
    const expected=PropertiesService.getScriptProperties().getProperty('WMS_CATALOG_SECRET');
    const request=JSON.parse(event && event.postData && event.postData.contents || '{}');
    if(!expected || expected.length<32 || typeof request.key!=='string' || request.key!==expected) return catalogJson_({success:false,code:'UNAUTHORIZED'});
    const cache=CacheService.getScriptCache(),cached=cache.get('catalog-cell-images-v1');
    if(cached) return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
    const book=SpreadsheetApp.openById(WMS_CATALOG_ID);
    const sheet=book.getSheets().find(function(item){return item.getSheetId()===WMS_CATALOG_SHEET_ID;});
    if(!sheet) return catalogJson_({success:false,code:'SHEET_MISSING'});
    const last=sheet.getLastRow(),images=[];
    const values=last>=2?sheet.getRange(2,2,last-1,2).getValues():[];
    let unreadable=0;
    values.forEach(function(row,index){
      const name=String(row[0] || '').trim(),image=row[1];
      if(!name || !image || image.valueType!==SpreadsheetApp.ValueType.IMAGE) return;
      try { const url=image.getContentUrl(); if(url) images.push({row:index+2,name:name,url:url}); else unreadable++; }
      catch(error) { unreadable++; }
    });
    const result={success:true,spreadsheetId:WMS_CATALOG_ID,sheetId:WMS_CATALOG_SHEET_ID,images:images,unreadable:unreadable};
    const body=JSON.stringify(result);
    if(body.length<90000) cache.put('catalog-cell-images-v1',body,120);
    return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
  } catch(error) { return catalogJson_({success:false,code:'SHEET_READ_FAILED'}); }
}
