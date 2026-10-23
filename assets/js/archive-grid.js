// Archive coordinates always refer to the original sheet, including empty rows.
export function archiveColumn(index){let name='';for(;index>0;index=Math.floor((index-1)/26))name=String.fromCharCode(65+(index-1)%26)+name;return name;}
export function archiveAddress(value){const match=/^([A-Z]{1,3})([1-9]\d*)$/.exec(String(value||'').trim().toUpperCase());if(!match)return null;let column=0;for(const char of match[1])column=column*26+char.charCodeAt(0)-64;return {column,row:Number(match[2]),address:match[0]};}
export function parseArchiveGrid(values=[],{formulaValues=values,gridProperties={}}={}){
 const width=[values,formulaValues].reduce((width,rows)=>rows.reduce((max,row)=>Math.max(max,row.length),width),1);
 const columnCount=Number(gridProperties.columnCount)||Math.max(26,width),rowCount=Number(gridProperties.rowCount)||Math.max(100,values.length+25);
 const columns=Array.from({length:Math.min(columnCount,Math.max(width,Math.min(26,columnCount)))},(_,i)=>archiveColumn(i+1));
 const rows=[];const result={columns,rows,headerError:false,rowCount,columnCount,usedRows:values.length};
 for(let i=0;i<Math.min(rowCount,Math.max(100,values.length+25,formulaValues.length));i++){const row={__rowNumber:i+1,__raw:{}};for(let c=0;c<columns.length;c++){row[columns[c]]=values[i]?.[c]??'';row.__raw[columns[c]]=formulaValues[i]?.[c]??'';}rows.push(row);}
 return result;
}
export function extendArchiveGrid(grid,address){const pos=archiveAddress(address);if(!pos||pos.row>grid.rowCount||pos.column>grid.columnCount)throw Error('Alamat sel di luar ukuran sheet.');
 // Do not create a giant rectangle of empty values; blank rows are sparse objects.
 while(grid.columns.length<pos.column)grid.columns.push(archiveColumn(grid.columns.length+1));
 while(grid.rows.length<pos.row)grid.rows.push({__rowNumber:grid.rows.length+1,__raw:{}});
 return pos;
}
export function archiveCellDescriptor(cell,grid,scope,sheet,spreadsheetId){const rowNumber=Number(cell.dataset.archiveRow),field=cell.dataset.archiveCol,row=grid?.rows[rowNumber-1];if(!row||!grid.columns.includes(field))return null;return {scope,key:JSON.stringify([scope,rowNumber,field]),field,rowNumber,sheet,spreadsheetId,rowRef:row,value:row.__raw[field]??'',validate(value){if(value.length>10000)throw Error('Nilai maksimal 10000 karakter.');}};}
