const TYPES={success:{title:'Berhasil',icon:'✓',duration:4000},error:{title:'Terjadi kendala',icon:'!',duration:10000},warning:{title:'Perlu diperhatikan',icon:'!',duration:7000},info:{title:'Informasi',icon:'i',duration:5000}};
export function createNotifications(container,{now=()=>Date.now(),schedule=setTimeout,cancel=clearTimeout}={}){
 if(!container)return {show(){},clear(){},dispose(){}};
 const doc=container.ownerDocument,entries=new Map(),abort=new AbortController();let disposed=false;
 container.setAttribute('aria-label','Notifikasi aplikasi');
 function remove(entry){cancel(entry.timer);entries.delete(entry.key);entry.node.remove();}
 function paused(entry){return doc.hidden||entry.hover||entry.focus;}
 function pause(entry){if(entry.timer){cancel(entry.timer);entry.timer=null;entry.remaining=Math.max(0,entry.remaining-(now()-entry.started));}}
 function resume(entry){if(disposed||!entries.has(entry.key)||paused(entry))return;pause(entry);entry.started=now();entry.timer=schedule(()=>remove(entry),entry.remaining);}
 function show(message,type='info',showClose=true){
  if(disposed)return;const text=String(message??'').trim();if(!text)return;
  const kind=TYPES[type]?type:'info',config=TYPES[kind],key=kind+'\0'+text,duration=Math.min(16000,config.duration+Math.max(0,text.length-180)*20);
  const existing=entries.get(key);if(existing){pause(existing);existing.remaining=duration;existing.count++;existing.repeat.hidden=false;existing.repeat.textContent=`${existing.count}×`;existing.repeat.setAttribute('aria-label',`${existing.count} kali`);resume(existing);return;}
  if(entries.size>=3){const oldest=[...entries.values()].find(item=>!item.focus&&item.kind!=='error')||[...entries.values()].find(item=>!item.focus);if(!oldest||(oldest.kind==='error'&&kind!=='error'))return;remove(oldest);}
  const node=doc.createElement('div');node.className=`toast-item show ${kind}`;node.setAttribute('role',kind==='error'?'alert':'status');node.setAttribute('aria-atomic','true');node.dataset.kind=kind;
  const icon=doc.createElement('span');icon.className='toast-icon';icon.setAttribute('aria-hidden','true');icon.textContent=config.icon;
  const content=doc.createElement('div');content.className='toast-content';const heading=doc.createElement('div');heading.className='toast-heading';const title=doc.createElement('strong');title.textContent=config.title;const repeat=doc.createElement('span');repeat.className='toast-repeat';repeat.hidden=true;heading.append(title,repeat);
  const body=doc.createElement('div');body.className='toast-message';body.textContent=text;content.append(heading,body);node.append(icon,content);
  const entry={key,node,kind,repeat,count:1,remaining:duration,timer:null,started:0,hover:false,focus:false};entries.set(key,entry);
  if(showClose){const close=doc.createElement('button');close.className='toast-close';close.type='button';close.setAttribute('aria-label','Tutup notifikasi');close.textContent='×';close.addEventListener('click',()=>remove(entry));node.append(close);}
  node.addEventListener('mouseenter',()=>{entry.hover=true;pause(entry);});node.addEventListener('mouseleave',()=>{entry.hover=false;resume(entry);});node.addEventListener('focusin',()=>{entry.focus=true;pause(entry);});node.addEventListener('focusout',event=>{if(node.contains(event.relatedTarget))return;entry.focus=false;resume(entry);});container.append(node);resume(entry);
 }
 doc.addEventListener('visibilitychange',()=>entries.forEach(entry=>doc.hidden?pause(entry):resume(entry)),{signal:abort.signal});
 return {show,clear(){[...entries.values()].forEach(remove);},dispose(){disposed=true;abort.abort();[...entries.values()].forEach(remove);}};
}
