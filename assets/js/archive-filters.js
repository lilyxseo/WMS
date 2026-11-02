import {filterMatches,compareFilterValues} from './table-filters.js';
export function archiveSpreadsheetRule(filter){
 if(!filter||filter.mode==='all')return null;
 if(filter.mode==='spreadsheet')return {values:filter.values??null,condition:filter.condition||'',text:filter.text||''};
 if(filter.mode==='values')return {values:[...(filter.values||[]),...(filter.includeEmpty?['']:[])],condition:'',text:''};
 return {values:null,condition:{exact:'equals',contains:'contains',empty:'empty'}[filter.mode]||'',text:filter.value||''};
}
export function archiveFilterValues(grid,column,{filters={},search='',columnFilter='all'}={}){
 const q=String(search).trim().toLocaleLowerCase('id-ID'),cols=grid.columns||[];
 return [...new Set((grid.rows||[]).filter(row=>(!q||cols.some(col=>String(row[col]??'').toLocaleLowerCase('id-ID').includes(q)))&&(!q||columnFilter==='all'||String(row[columnFilter]??'').toLocaleLowerCase('id-ID').includes(q))&&Object.entries(filters).every(([col,filter])=>col===column||filterMatches(row[col],archiveSpreadsheetRule(filter)))).map(row=>String(row[column]??'').trim()))].sort(compareFilterValues);
}
