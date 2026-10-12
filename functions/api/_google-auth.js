import { getSecretSupabaseConfig } from './_supabase-config.js';

// Used only by Pages Functions. Never return this token from an application API.
export async function getGoogleAccessToken(env, fetchFn = fetch) {
  const { url, key } = getSecretSupabaseConfig(env);
  let response;
  try {
    response = await fetchFn(`${url}/functions/v1/app-google-auth`, {
      method: 'POST', headers: { apikey: key, 'X-WMS-Server-Key': key },
      redirect: 'error', signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error('Koneksi autentikasi Gmail di Supabase gagal. Tidak ada perubahan ditulis.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || typeof data.access_token !== 'string' || !data.access_token) {
    throw new Error('Autentikasi Gmail di Supabase gagal. Periksa konfigurasi OAuth dan akses server aplikasi.');
  }
  return data.access_token;
}
