export async function saveSearch(config, sender, search, fetchFn) {
  const response = await fetchFn(`${config.url}/rest/v1/whatsapp_search_sessions?on_conflict=sender`, {
    method: 'POST', headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ sender, search, expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString() }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Search session save failed');
}

export async function loadSearch(config, sender, fetchFn) {
  const response = await fetchFn(`${config.url}/rest/v1/whatsapp_search_sessions?select=search&sender=eq.${encodeURIComponent(sender)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`, {
    headers: { apikey: config.key, Authorization: `Bearer ${config.key}` }, signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Search session read failed');
  const rows = await response.json();
  return Array.isArray(rows) ? rows[0]?.search : undefined;
}
