const COLORS=Object.freeze({red:'Merah',blue:'Biru',green:'Hijau',purple:'Ungu',amber:'Amber'});
const STORAGE_KEY='wms.accent';
export function mountAccentColors(root){
 if(!root)return;
 const selected=()=>document.documentElement.dataset.accent||'red';
 const render=()=>root.querySelectorAll('[data-accent-choice]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.accentChoice===selected())));
 const summary=root.querySelector('summary');
 root.querySelectorAll('[data-accent-choice]').forEach(button=>button.addEventListener('click',()=>{
  const color=button.dataset.accentChoice;if(!Object.hasOwn(COLORS,color))return;
  document.documentElement.dataset.accent=color;
  try{localStorage.setItem(STORAGE_KEY,color);}catch{}
  render();root.open=false;summary?.focus();
 }));
 root.addEventListener('keydown',event=>{if(event.key==='Escape'&&root.open){event.preventDefault();root.open=false;summary?.focus();}});
 document.addEventListener('click',event=>{if(root.open&&!root.contains(event.target))root.open=false;});
 window.addEventListener('storage',event=>{if(event.key===STORAGE_KEY){document.documentElement.dataset.accent=Object.hasOwn(COLORS,event.newValue)?event.newValue:'red';render();}});
 render();
}
