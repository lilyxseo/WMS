import { createVerifiedDevToken } from './_note-identity.js';
import { getPublishableSupabaseConfig, getSecretSupabaseConfig } from './_supabase-config.js';

const DEV_SESSION_TTL_SECONDS = 60 * 60 * 12;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function safeEquals(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;

  let out = 0;
  for (let i = 0; i < a.length; i += 1) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return out === 0;
}

const INVALID_CREDENTIALS_RESPONSE = {
  success: false,
  reason: "INVALID_LOGIN_CREDENTIALS",
  message: "Username atau password salah.",
};

function isEmail(identifier) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
}

async function resolveLoginEmail(identifier, env) {
  if (isEmail(identifier)) return identifier.toLowerCase();

  const { url, key } = getSecretSupabaseConfig(env);
  const params = new URLSearchParams({
    select: "email",
    username: `eq.${identifier}`,
    limit: "1",
  });
  const response = await fetch(`${url}/rest/v1/users?${params}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error("USERNAME_LOOKUP_FAILED");
  return String(rows?.[0]?.email || "").trim().toLowerCase();
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();

    const normalizedIdentifier = String(body.identifier || body.email || "").trim();
    const normalizedPassword = String(body.password || "");

    if (!normalizedIdentifier || !normalizedPassword) {
      return json({ success: false, reason: "INVALID_LOGIN_PAYLOAD", message: "Username/email dan password wajib diisi." }, 400);
    }

    /**
     * OPTIONAL DEVELOPER LOGIN
     * Tidak boleh mengganggu login Supabase/database normal.
     */
    const devLoginReady =
      String(env.DEV_LOGIN_ENABLED || "").toLowerCase() === "true" &&
      env.DEV_USERNAME &&
      env.DEV_PASSWORD;

    if (devLoginReady) {
      const devUsername = String(env.DEV_USERNAME || "");
      const devPassword = String(env.DEV_PASSWORD || "");

      if (
        safeEquals(normalizedIdentifier, devUsername) &&
        safeEquals(normalizedPassword, devPassword)
      ) {
        const accessToken = await createVerifiedDevToken(env, normalizedIdentifier);
        const expiresAt =
          Math.floor(Date.now() / 1000) + DEV_SESSION_TTL_SECONDS;

        return json({
          mode: "dev",
          session: {
            access_token: accessToken,
            refresh_token: null,
            token_type: "bearer",
            expires_in: DEV_SESSION_TTL_SECONDS,
            expires_at: expiresAt,
          },
          user: {
            id: "developer",
            email: normalizedIdentifier,
            name: "Developer",
            role: "Mode Development",
            isDeveloper: true,
          },
        });
      }
    }

    /**
     * NORMAL DATABASE LOGIN VIA SUPABASE
     */
    const { url: supabaseUrl, key: supabasePublishableKey } = getPublishableSupabaseConfig(env);
    const normalizedEmail = await resolveLoginEmail(normalizedIdentifier, env);
    if (!normalizedEmail) return json(INVALID_CREDENTIALS_RESPONSE, 401);

    const resp = await fetch(
      `${supabaseUrl}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: {
          apikey: supabasePublishableKey,
          Authorization: `Bearer ${supabasePublishableKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: normalizedEmail,
          password: normalizedPassword,
        }),
      }
    );

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      const upstreamErrorCode = String(data.error_code || data.code || data.error || "AUTH_LOGIN_FAILED");
      const errorCode = upstreamErrorCode === "invalid_credentials" ? "INVALID_LOGIN_CREDENTIALS" : upstreamErrorCode.toUpperCase();
      const message = String(data.error_description || data.msg || data.message || "Login gagal.");
      console.warn("[SUPABASE_LOGIN_FAILED]", {
        status: resp.status,
        error_code: upstreamErrorCode,
        message,
      });
      return json(
        {
          success: false,
          reason: errorCode,
          message: errorCode === "INVALID_LOGIN_CREDENTIALS" ? INVALID_CREDENTIALS_RESPONSE.message : message,
        },
        resp.status === 401 || resp.status === 400 ? 401 : resp.status
      );
    }

    if (!data.access_token || !data.refresh_token) {
      console.warn("[SUPABASE_LOGIN_FAILED]", {
        status: 502,
        error_code: "AUTH_SESSION_INCOMPLETE",
        message: "Supabase Auth response did not include both session tokens.",
      });
      return json({ success: false, reason: "AUTH_SESSION_INCOMPLETE", message: "Sesi login tidak lengkap." }, 502);
    }

    return json({
      success: true,
      mode: "supabase",
      session: {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        token_type: data.token_type,
        expires_in: data.expires_in,
        expires_at: data.expires_at,
      },
      user: data.user || null,
    });
  } catch (err) {
    if (err?.message === 'USERNAME_LOOKUP_FAILED') {
      console.error('[USERNAME_LOOKUP_FAILED] Unable to resolve login identifier.');
      return json({ success: false, reason: "AUTH_SERVICE_UNAVAILABLE", message: "Layanan login sedang tidak tersedia." }, 502);
    }
    if (String(err?.message || '').startsWith('SUPABASE_')) {
      console.error('Invalid Supabase login configuration:', err.message);
      return json({ success: false, reason: "AUTH_CONFIGURATION_ERROR", message: err.message }, 500);
    }
    return json({ success: false, reason: "INVALID_LOGIN_PAYLOAD", message: "Payload login tidak valid." }, 400);
  }
}
