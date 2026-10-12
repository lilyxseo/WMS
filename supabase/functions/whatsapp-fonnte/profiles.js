export class ProfileError extends Error {}

export function normalizePhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.startsWith('0') ? `62${digits.slice(1)}` : digits;
}
export function canWriteStock(profile) {
  const role = String(profile?.role || '').trim().toLowerCase();
  return role.includes('pic') || role === 'developer';
}

export async function findPhoneProfile(config, sender, fetchFn) {
  const normalized = normalizePhone(sender);
  if (!/^62\d{8,13}$/.test(normalized)) throw new ProfileError('Nomor WhatsApp tidak valid.');
  const variants = [normalized, `+${normalized}`, `0${normalized.slice(2)}`];
  const filter = encodeURIComponent(`(${variants.map(value => `"${value}"`).join(',')})`);
  const response = await fetchFn(`${config.url}/rest/v1/users?select=id,full_name,username,email,role,phone_number&phone_number=in.${filter}&limit=2`, {
    headers: { apikey: config.key, Authorization: `Bearer ${config.key}` }, signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new ProfileError('Profil user belum dapat dibaca. Periksa kolom users.phone_number dan akses database bot.');
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new ProfileError('Respons profil user tidak valid.');
  if (rows.length > 1) throw new ProfileError('Nomor WhatsApp terhubung ke lebih dari satu profil. Admin perlu memperbaiki data nomor telepon.');
  if (!rows.length) return undefined;
  const profile = rows[0];
  if (!profile.id || normalizePhone(profile.phone_number) !== normalized) throw new ProfileError('Profil tidak cocok dengan nomor WhatsApp pengirim.');
  return profile;
}

export async function requireStockProfile(config, sender, fetchFn) {
  const profile = await findPhoneProfile(config, sender, fetchFn);
  if (!profile) throw new ProfileError('Nomor WhatsApp belum terdaftar di profil WMS. Admin perlu mengisi users.phone_number.');
  if (!canWriteStock(profile)) throw new ProfileError('Akses read-only. Hanya role PIC atau Developer yang dapat menyimpan stock in/out.');
  return profile;
}
