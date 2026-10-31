import {FILTER_CONDITIONS,filterMatches,sortFilterValues} from '../../assets/js/table-filters.js';
const names={from:'from_location',to:'to_location',namaBarang:'nama_barang'};
export function transactionFilterOptions(params,allowed){
 let rules={};try{rules=JSON.parse(params.get('columnRules')||'{}');}catch{throw new RangeError('Filter kolom tidak valid.');}
 if(!rules||typeof rules!=='object'||Array.isArray(rules)||Object.keys(rules).length>allowed.length)throw new RangeError('Filter kolom tidak valid.');
 for(const [field,rule] of Object.entries(rules))if(!allowed.includes(field)||!rule||!FILTER_CONDITIONS.some(([key])=>key===(rule.condition||''))||typeof (rule.text||'')!=='string'||String(rule.text||'').length>500||rule.values!==null&&(!Array.isArray(rule.values)||rule.values.length>20000||rule.values.some(value=>typeof value!=='string'||value.length>2000)))throw new RangeError('Filter kolom tidak valid.');
 const facet=params.get('facet')||'',sortField=params.get('columnSort')||'';if(facet&&!allowed.includes(facet)||sortField&&!allowed.includes(sortField))throw new RangeError('Kolom tidak valid.');
 return {columnRules:rules,facet,sortField,sortDir:params.get('columnDirection')==='-1'?-1:1};
}
export function transactionFilterRows(entries,{columnRules={},facet='',sortField='',sortDir=1}={}){
 const value=(entry,field)=>String(entry.row[names[field]||field]??'').trim(),matches=(entry,omit='')=>Object.entries(columnRules).every(([field,rule])=>field===omit||filterMatches(value(entry,field),rule));
 const facetValues=facet?[...new Set(entries.filter(entry=>matches(entry,facet)).map(entry=>value(entry,facet)))].sort((a,b)=>sortFilterValues(a,b)):undefined;
 const filtered=entries.filter(entry=>matches(entry));if(sortField)filtered.sort((a,b)=>sortFilterValues(value(a,sortField),value(b,sortField),sortDir,sortField==='qty'));
 return {filtered,facetValues};
}
