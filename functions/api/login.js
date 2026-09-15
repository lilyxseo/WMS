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

function toBase64Url(value) {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function createDevToken(secret, username) {
  const payload = {
    sub: "developer",
    username,
    role: "Mode Development",
    isDeveloper: true,
    exp: Math.floor(Date.now() / 1000) + DEV_SESSION_TTL_SECONDS,
  };

  const base = toBase64Url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(base));
  const sig = toBase64Url(String.fromCharCode(...new Uint8Array(signed)));

  return `${base}.${sig}`;
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
    username: `ilike.${identifier}`,
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
    const identifierType = isEmail(normalizedIdentifier) ? "email" : "username";

    console.info(`[Login] identifier type: ${identifierType}`);

    if (!normalizedIdentifier || !normalizedPassword) {
      console.info("[Login] username resolved: false");
      console.info("[Login] developer path matched: false");
      console.info("[Login] supabase auth status: not_attempted");
      console.info("[Login] profile lookup status: not_attempted");
      console.info("[Login] final rejection reason: INVALID_LOGIN_PAYLOAD");
      return json({ success: false, reason: "INVALID_LOGIN_PAYLOAD", message: "Username/email dan password wajib diisi." }, 400);
    }

    // Resolve before developer matching. Prior to server-side resolution the
    // browser passed this email to /api/login, so DEV_USERNAME may intentionally
    // contain the resolved developer email rather than the displayed username.
    const normalizedEmail = await resolveLoginEmail(normalizedIdentifier, env);
    const usernameResolved = identifierType === "email" || Boolean(normalizedEmail);
    console.info(`[Login] username resolved: ${usernameResolved}`);
    console.info(`[Login] profile lookup status: ${identifierType === "username" ? (normalizedEmail ? "found" : "not_found") : "not_required"}`);

    /**
     * OPTIONAL DEVELOPER LOGIN
     * Tidak boleh mengganggu login Supabase/database normal.
     */
    const devUsername = String(env.DEV_USERNAME || "").trim().toLowerCase();
    const developerPathMatched = Boolean(devUsername) && (
      safeEquals(normalizedIdentifier.toLowerCase(), devUsername) ||
      (normalizedEmail && safeEquals(normalizedEmail, devUsername))
    );
    const devLoginReady =
      String(env.DEV_LOGIN_ENABLED || "").toLowerCase() === "true" &&
      devUsername &&
      env.DEV_PASSWORD &&
      env.DEV_SESSION_SECRET;

    console.info(`[Login] developer path matched: ${developerPathMatched}`);

    if (developerPathMatched && !devLoginReady) {
      console.info("[Login] supabase auth status: not_attempted");
      console.info("[Login] final rejection reason: DEVELOPER_CONFIG_MISSING");
      return json(INVALID_CREDENTIALS_RESPONSE, 401);
    }

    if (developerPathMatched) {
      const devPassword = String(env.DEV_PASSWORD || "");

      if (safeEquals(normalizedPassword, devPassword)) {
        const secret = String(env.DEV_SESSION_SECRET);

        const accessToken = await createDevToken(secret, normalizedIdentifier);
        const expiresAt =
          Math.floor(Date.now() / 1000) + DEV_SESSION_TTL_SECONDS;

        console.info("[Login] supabase auth status: not_attempted");
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

      console.info("[Login] supabase auth status: not_attempted");
      console.info("[Login] final rejection reason: DEVELOPER_INVALID_CREDENTIALS");
      return json(INVALID_CREDENTIALS_RESPONSE, 401);
    }

    /**
     * NORMAL DATABASE LOGIN VIA SUPABASE
     */
    const { url: supabaseUrl, key: supabasePublishableKey } = getPublishableSupabaseConfig(env);
    if (!normalizedEmail) {
      console.info("[Login] supabase auth status: not_attempted");
      console.info("[Login] final rejection reason: USERNAME_NOT_RESOLVED");
      return json(INVALID_CREDENTIALS_RESPONSE, 401);
    }

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
      console.info(`[Login] supabase auth status: rejected_${resp.status}`);
      console.info(`[Login] final rejection reason: ${errorCode === "INVALID_LOGIN_CREDENTIALS" ? "SUPABASE_INVALID_CREDENTIALS" : errorCode}`);
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
      console.info("[Login] supabase auth status: incomplete_session");
      console.info("[Login] final rejection reason: SESSION_CREATION_FAILED");
      return json({ success: false, reason: "AUTH_SESSION_INCOMPLETE", message: "Sesi login tidak lengkap." }, 502);
    }

    console.info("[Login] supabase auth status: authenticated");

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
      console.info("[Login] profile lookup status: failed");
      console.info("[Login] supabase auth status: not_attempted");
      console.info("[Login] final rejection reason: USERNAME_LOOKUP_FAILED");
      return json({ success: false, reason: "AUTH_SERVICE_UNAVAILABLE", message: "Layanan login sedang tidak tersedia." }, 502);
    }
    if (String(err?.message || '').startsWith('SUPABASE_')) {
      console.error('Invalid Supabase login configuration:', err.message);
      return json({ success: false, reason: "AUTH_CONFIGURATION_ERROR", message: err.message }, 500);
    }
    return json({ success: false, reason: "INVALID_LOGIN_PAYLOAD", message: "Payload login tidak valid." }, 400);
  }
}
