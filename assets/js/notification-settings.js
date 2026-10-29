export async function renderNotificationSettings(root,{fetchFn,isCurrent=()=>true}={}){
 root.hidden=false;root.innerHTML='<p class="settings-note">Memuat pengaturan notifikasi…</p>';
 const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
 try{
  const response=await fetchFn('/api/notification-settings'),data=await response.json();if(!isCurrent())return;
  if(response.status===403){root.hidden=true;return;}if(!response.ok||!data.success)throw Error(data.message||'Pengaturan belum tersedia.');
  const busy=new Set();
  const cells=(user,index)=>`<td>${esc(user.name)}<small style="display:block">${esc(user.username)}</small></td><td><button type="button" class="notification-phone-edit" data-phone-edit="${index}" aria-label="Edit nomor HP ${esc(user.name)}">${esc(user.phone||'Tambah nomor HP')} <span aria-hidden="true">✎</span></button></td>${['warning_enabled','bot_enabled'].map(field=>`<td><label class="notification-toggle"><input type="checkbox" role="switch" data-user="${index}" data-field="${field}" aria-label="${field==='warning_enabled'?'Warning':'Akses bot'} untuk ${esc(user.name)}" ${user[field]?'checked':''} ${user.phone?'':'disabled'}><span class="notification-toggle-track" aria-hidden="true"></span><span class="notification-toggle-text">${user.phone?'<span class="notification-toggle-on">Aktif</span><span class="notification-toggle-off">Nonaktif</span>':'Isi nomor HP'}</span></label></td>`).join('')}`;
  root.innerHTML=`<div class="settings-head"><h4>Notifikasi & Akses Bot</h4></div><p class="settings-desc">Klik nomor HP untuk mengedit. Warning dan bot membutuhkan nomor WhatsApp.</p><div class="table-wrap"><table><thead><tr><th>User</th><th>WhatsApp</th><th>Warning</th><th>Akses bot</th></tr></thead><tbody>${data.users.map((user,index)=>`<tr data-notification-row="${index}">${cells(user,index)}</tr>`).join('')}</tbody></table></div><p data-notification-status role="status" class="settings-note"></p>`;
  const row=index=>root.querySelector(`[data-notification-row="${index}"]`),paint=index=>{if(isCurrent())row(index).innerHTML=cells(data.users[index],index);},status=root.querySelector('[data-notification-status]');
  async function save(index,payload){
   if(busy.has(index)||!isCurrent())return;busy.add(index);row(index).querySelectorAll('input,button').forEach(control=>control.disabled=true);status.textContent='Menyimpan…';
   try{const response=await fetchFn('/api/notification-settings',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),result=await response.json();if(!isCurrent())return;if(!response.ok||!result.success)throw Error(result.message||'Perubahan belum tersimpan.');
    const user=data.users[index];if(Object.hasOwn(payload,'phone')){user.phone=result.phone;if(!user.phone){user.warning_enabled=false;user.bot_enabled=false;}}else Object.assign(user,payload);
    paint(index);status.textContent='Perubahan disimpan.';
   }catch(error){if(isCurrent()){status.textContent=error.message;if(!Object.hasOwn(payload,'phone'))paint(index);}}
   finally{busy.delete(index);if(isCurrent()){row(index).querySelectorAll('button,input').forEach(control=>control.disabled=control.matches('input[type=checkbox]')&&!data.users[index].phone);}}
  }
  root.onchange=event=>{if(!isCurrent())return;const input=event.target.closest('input[data-user]');if(!input)return;const index=Number(input.dataset.user),user=data.users[index];void save(index,{user_id:user.id,warning_enabled:user.warning_enabled,bot_enabled:user.bot_enabled,[input.dataset.field]:input.checked});};
  root.onclick=event=>{if(!isCurrent())return;const edit=event.target.closest('[data-phone-edit]'),cancel=event.target.closest('[data-phone-cancel]');if(cancel){const index=Number(cancel.dataset.phoneCancel);if(!busy.has(index))paint(index);return;}if(!edit)return;const index=Number(edit.dataset.phoneEdit);if(busy.has(index))return;
   edit.closest('td').innerHTML=`<form class="notification-phone-form" data-phone-form="${index}"><input type="tel" name="phone" inputmode="tel" autocomplete="off" aria-label="Nomor HP ${esc(data.users[index].name)}" value="${esc(data.users[index].phone)}" placeholder="08… / 628…"><div><button class="btn-primary" type="submit">Simpan</button><button class="btn-ghost" type="button" data-phone-cancel="${index}">Batal</button></div></form>`;
   const input=row(index).querySelector('input[name=phone]');input.focus();input.select();
  };
  root.onsubmit=event=>{const form=event.target.closest('[data-phone-form]');if(!form)return;event.preventDefault();if(!isCurrent())return;const index=Number(form.dataset.phoneForm);void save(index,{user_id:data.users[index].id,phone:form.elements.phone.value});};
  root.onkeydown=event=>{if(event.key!=='Escape')return;const form=event.target.closest('[data-phone-form]');if(form&&!busy.has(Number(form.dataset.phoneForm))){event.preventDefault();paint(Number(form.dataset.phoneForm));}};
 }catch(error){if(isCurrent()){root.textContent=error.message;const retry=document.createElement('button');retry.className='btn-ghost';retry.textContent='Coba lagi';retry.onclick=()=>renderNotificationSettings(root,{fetchFn,isCurrent});root.append(retry);}}
}
