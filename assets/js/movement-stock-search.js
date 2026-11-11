// Searches only matching stock rows; never waits for the full stock preload.
export function createMovementStockSearch({fetchFn=fetch,onState=()=>{},isCurrent=()=>true,delay=80}={}){
 let state={query:'',rows:[],status:'idle'},timer,controller,version=0,disposed=false;
 const emit=next=>{state=next;if(!disposed&&isCurrent())onState(state);};
 function search(value,{force=false}={}){
  if(disposed)return;
  const query=String(value??'').trim();if(!force&&query===state.query)return;
  clearTimeout(timer);controller?.abort();const token=++version;
  if(query.length<2){emit({query,rows:[],status:'idle'});return;}
  emit({query,rows:[],status:'loading'});
  const run=async()=>{controller=new AbortController();const active=controller,timeout=setTimeout(()=>active.abort(),18000);
   try{const response=await fetchFn('/api/movement/search?q='+encodeURIComponent(query),{cache:'no-store',signal:active.signal}),data=await response.json();if(disposed||token!==version||!isCurrent())return;if(!response.ok||!data?.success||!Array.isArray(data.rows))throw Error('Pencarian belum tersedia.');emit({query,rows:data.rows,status:'ready'});}
   catch{if(!disposed&&token===version&&isCurrent())emit({query,rows:[],status:'error'});}
   finally{clearTimeout(timeout);}
  };
  if(/^\d{8,}$/.test(query))void run();else timer=setTimeout(run,delay);
 }
 return {search,get state(){return state;},dispose(){disposed=true;version++;clearTimeout(timer);controller?.abort();}};
}
