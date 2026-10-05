import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

async function loadPublicSupabaseConfig() {
  if (SUPABASE_PUBLISHABLE_KEY) return { url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY };
  const response = await fetch("/api/runtime-config", { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.supabaseUrl || !data.supabaseAnonKey) {
    throw new Error("Supabase publishable key belum dikonfigurasi dengan aman");
  }
  return { url: data.supabaseUrl, key: data.supabaseAnonKey };
}

const publicSupabaseConfig = await loadPublicSupabaseConfig();
export const supabase = createClient(publicSupabaseConfig.url, publicSupabaseConfig.key, {
  auth: {
    // Keep the refresh token in localStorage so a full page reload can restore
    // the login instead of treating it as a new browser session.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

const AUTH_STARTUP_TIMEOUT_MS = 8000;

function withAuthTimeout(promise, operation) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`${operation} tidak merespons setelah ${AUTH_STARTUP_TIMEOUT_MS}ms`)),
      AUTH_STARTUP_TIMEOUT_MS,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function parseJsonResponse(resp, fallbackMessage) {
  const contentType = resp.headers.get("content-type") || "";
  if (contentType.toLowerCase().includes("application/json")) {
    return resp.json();
  }
  const rawText = await resp.text();
  const trimmed = String(rawText || "").trim();
  const isHtml = trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html");
  const message = isHtml
    ? `${fallbackMessage} (HTTP ${resp.status} ${resp.statusText})`
    : `${fallbackMessage}: ${trimmed || "Respons tidak valid"}`;
  throw new Error(message);
}

export async function getSession() {
  try {
    const { data, error } = await withAuthTimeout(supabase.auth.getSession(), "supabase.auth.getSession()");
    if (error) throw error;
    return data.session;
  } catch (error) {
    console.error("supabase.auth.getSession() failed", error);
    throw error;
  }
}

export async function getAuthenticatedUser() {
  try {
    const result = await withAuthTimeout(supabase.auth.getUser(), "supabase.auth.getUser()");
    return result;
  } catch (error) {
    console.error("supabase.auth.getUser() failed", error);
    throw error;
  }
}

const DEV_SESSION_KEY = "dev_auth_session";
const APP_AUTH_STORAGE_KEYS = ["user", "currentUser"];

export function clearAppAuthState() {
  localStorage.removeItem(DEV_SESSION_KEY);
  for (const key of APP_AUTH_STORAGE_KEYS) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  }
  for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = sessionStorage.key(index);
    if (key?.startsWith("activity-auto-login:")) sessionStorage.removeItem(key);
  }
}

export async function restoreSession({ allowDeveloperSession = false } = {}) {
  const raw = localStorage.getItem(DEV_SESSION_KEY);
  if (raw && allowDeveloperSession) {
    try {
      const dev = JSON.parse(raw);
      const expiresAt = Number(dev?.session?.expires_at || dev?.expires_at || 0);
      if (expiresAt > Math.floor(Date.now() / 1000) && dev?.session?.access_token) {
        return { isDeveloper: true, user: dev.user || null, ...dev.session };
      }
      localStorage.removeItem(DEV_SESSION_KEY);
    } catch (_err) {
      localStorage.removeItem(DEV_SESSION_KEY);
    }
  } else if (raw) {
    localStorage.removeItem(DEV_SESSION_KEY);
  }
  const session = await getSession();
  return session;
}

export async function ensureAuthSession() {
  // Developer login is already explicit; API calls may reuse its short-lived token.
  return restoreSession({ allowDeveloperSession: true });
}

export async function loginWithEmailPassword(identifier, password) {
  const resp = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });
  const data = await parseJsonResponse(resp, "Endpoint login tidak ditemukan");
  if (!resp.ok) throw new Error(data?.message || "Login gagal.");

  if (data?.mode === "dev") {
    localStorage.setItem(DEV_SESSION_KEY, JSON.stringify({ session: data.session, user: data.user }));
    return { data, error: null };
  }

  localStorage.removeItem(DEV_SESSION_KEY);
  const { error } = await supabase.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
  if (error) throw error;
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData?.session?.access_token || sessionData.session.access_token !== data.session.access_token) {
    throw new Error("Sesi login gagal disimpan.");
  }
  return { data, error: null };
}


export async function getAuthHeaders() {
  const session = await ensureAuthSession();
  const token = session?.access_token || session?.session?.access_token || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function authFetch(input, init = {}) {
  const headers = new Headers(init.headers || {});
  const authHeaders = await getAuthHeaders();
  Object.entries(authHeaders).forEach(([key, value]) => {
    if (!headers.has(key)) headers.set(key, value);
  });
  return fetch(input, { ...init, headers });
}

export async function logout() {
  // Clear the app/developer identity even when the remote sign-out request fails.
  // Supabase's own persisted session is still managed by signOut(), not globally disabled.
  clearAppAuthState();
  return supabase.auth.signOut();
}

export function bindLogoutButtons(selector = '[data-logout-btn]') {
  document.querySelectorAll(selector).forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await logout();
      } finally {
        clearAppAuthState();
        window.dispatchEvent(new CustomEvent('auth:logout'));
        btn.disabled = false;
      }
    });
  });
}
