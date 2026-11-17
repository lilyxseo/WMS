export function createAdvanceSearchHistory({account='',storage}={}){
 const storageKey=account?'wms:advance-search-history:v1:'+encodeURIComponent(account):null;
 if(storage===undefined){try{storage=globalThis.localStorage;}catch{}}
 let entries=[];
 const normalize=value=>typeof value==='string'?value.trim().slice(0,200):'';
 try{
  const saved=storageKey?JSON.parse(storage?.getItem(storageKey)||'[]'):[];
  if(Array.isArray(saved))for(const value of saved){const query=normalize(value);if(query&&!entries.some(item=>item.toUpperCase()===query.toUpperCase()))entries.push(query);if(entries.length===20)break;}
 }catch{}
 const persist=()=>{try{if(storageKey)storage?.setItem(storageKey,JSON.stringify(entries));}catch{}};
 return {
  get entries(){return [...entries];},
  add(value){const query=normalize(value);if(!query)return;entries=[query,...entries.filter(item=>item.toUpperCase()!==query.toUpperCase())].slice(0,20);persist();},
  clear(){entries=[];try{if(storageKey)storage?.removeItem(storageKey);}catch{}}
 };
}
