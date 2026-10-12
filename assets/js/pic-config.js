// Shared by the WMS application and the WhatsApp Edge Function.
export const PIC_BY_ROLE = Object.freeze({
  inventory: 'ABI',
  inbound: 'ENGGAL',
  outbound: 'EPRIL',
  picker: 'WINDI',
  developer: 'ABI',
});
export function resolvePic(role) {
  const value = String(role || '').toLowerCase().replace('pic', '').replace('role', '').replace('mode', '').trim();
  const key = value.includes('dev') ? 'developer' : ['inbound', 'outbound', 'picker', 'inventory'].find(key => value.includes(key));
  return String(PIC_BY_ROLE[key] || PIC_BY_ROLE.inventory).toUpperCase();
}
