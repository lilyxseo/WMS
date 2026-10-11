export async function writeStockAudit(config, profile, state, result, fetchFn) {
  const payload = {
    user_id: profile.id, user_name: String(profile.email || profile.full_name || profile.username), role: profile.role,
    action: state.direction === 'in' ? 'CREATE_BARANG_MASUK' : 'CREATE', module: state.direction === 'in' ? 'Barang Masuk' : 'Barang Keluar',
    detail: `${state.direction === 'in' ? 'Inbound' : 'Outbount'} ${state.row.sku}, qty ${state.qty}, From ${result.from}, To ${result.to}, PIC ${state.pic}.`,
    reference: state.nonce, status: 'SUCCESS',
    metadata: { source: 'WHATSAPP', actor_email: profile.email || '', actor_name: profile.full_name, sheetRow: result.rowNumber, sku: state.row.sku, qty: state.qty, from: result.from, to: result.to, pic: state.pic, keterangan: result.keterangan },
  };
  const response = await fetchFn(`${config.url}/rest/v1/activity_logs`, { method: 'POST', headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Stock audit failed');
}

export async function writeMovementAudit(config, profile, state, result, fetchFn) {
  const payload = {
    user_id: profile.id, user_name: String(profile.email || profile.full_name || profile.username || profile.id), role: profile.role,
    action: 'CREATE_MOVEMENT', module: 'Movement', status: 'SUCCESS', reference: state.nonce,
    detail: `Movement ${state.row.sku}, From ${result.from}, To ${result.to}, qty ${state.qty}, PIC ${state.pic}.`,
    metadata: { source: 'WHATSAPP', actor_email: profile.email || '', actor_name: profile.full_name, sheetRow: result.rowNumber, tanggal: result.date, sku: state.row.sku, from: result.from, to: result.to, qty: state.qty, stokDiLokasiAwal: state.row.stok_akhir, stokAktual: state.qty, status: 'Movement', pic: state.pic, keterangan: 'INTERNAL STOCK TRANSFER', syncedTo2026: true },
  };
  const response = await fetchFn(`${config.url}/rest/v1/activity_logs`, { method: 'POST', headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Movement audit failed');
}
