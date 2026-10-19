import { getSecretSupabaseConfig } from './_supabase-config.js';

// Used only by Pages Functions. Never return this token from an application API.
export async function getGoogleAccessToken(env, fetchFn = fetch) {
  const { url, key } = getSecretSupabaseConfig(env);
  let response;
  try {
    response = await fetchFn(`${url}/functions/v1/app-google-auth`, {
      method: 'POST', headers: { apikey: key, 'X-WMS-Server-Key': key },
      redirect: 'manual', signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error('Koneksi autentikasi Gmail di Supabase gagal. Tidak ada perubahan ditulis.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || typeof data.access_token !== 'string' || !data.access_token) {
    const messages={OAUTH_REFRESH_TOKEN_REJECTED:'Refresh token Gmail ditolak Google. Hubungkan ulang Gmail dan perbarui GOOGLE_OAUTH_REFRESH_TOKEN di Supabase.',OAUTH_INVALID_CLIENT:'Client OAuth Gmail ditolak Google. Periksa Client ID dan Client Secret di Supabase.'};
    throw new Error(messages[data.code]||'Autentikasi Gmail di Supabase gagal. Periksa konfigurasi OAuth dan akses server aplikasi.');
  }
  return data.access_token;
}
