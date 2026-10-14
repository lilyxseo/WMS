import { hasInventoryDeveloperAccess } from './_authz.js';
import { getSecretSupabaseConfig } from './_supabase-config.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ALLOWED_ACTIONS = new Set([
  "LOGIN", "AUTO_LOGIN", "LOGIN_FAILED", "PAGE_VIEW", "CREATE", "UPDATE", "DELETE",
  "CHECKLIST", "UNCHECK", "IMPORT", "EXPORT", "MOVEMENT", "BATCH_UPDATE", "UNDO", "REDO",
  "REFRESH", "LOGOUT", "SESSION_EXPIRED", "SEARCH",
  "LOGIN_SUCCESS", "LOGIN_DEVELOPER",
  "SUBMIT_CYCLE_COUNT",
  "EDIT_CYCLE_COUNT",
  "DELETE_CYCLE_COUNT",
  "SUBMIT_MOVEMENT",
  "CREATE_BARANG_MASUK",
  "EDIT_MOVEMENT",
  "DELETE_MOVEMENT",
  "SCAN_BARCODE_SKU",
  "REGISTER_SUCCESS",
  "INPUT_BARANG_MASUK_REJECT",
  "INPUT_BARANG_KELUAR_REJECT",
  "EDIT_BARANG_REJECT",
  "DELETE_BARANG_REJECT",
  "REFRESH_BARANG_REJECT",
  "EXPORT_CSV_BARANG_REJECT",
  "SCAN_BARCODE_REJECT",
]);

const ALLOWED_STATUS = new Set(["SUCCESS", "FAILED", "DENIED"]);

function sanitizeText(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function sanitizeMetadata(raw) {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    const key = String(k || "").toLowerCase();
    if (key.includes("password") || key.includes("token") || key.includes("secret")) continue;
    if (typeof v === "string") out[k] = v.slice(0, 500);
    else if (typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
    else out[k] = JSON.stringify(v).slice(0, 500);
  }
  return out;
}


function decodeJwtPayload(token) {
  try {
    const part = String(token || "").split(".")[0];
    if (!part) return null;
    return JSON.parse(atob(part));
  } catch (_err) {
    return null;
  }
}

function parseTrue(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function isPreviewBypassRequest(request, env) {
  const previewBypassLogin = parseTrue(
    env?.PREVIEW_BYPASS_LOGIN ?? env?.NEXT_PUBLIC_PREVIEW_BYPASS_LOGIN ?? env?.VITE_PREVIEW_BYPASS_LOGIN
  );
  return previewBypassLogin && request.headers.get("x-preview-bypass-login") === "true";
}

function isDeveloperRequest(request, env) {
  if (isPreviewBypassRequest(request, env)) return true;
  const auth = String(request.headers.get("authorization") || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const payload = decodeJwtPayload(token);
  return payload?.isDeveloper === true;
}

function getSupabaseConfig(env) {
  return getSecretSupabaseConfig(env);
}

async function supabaseInsertLog(env, payload) {
  const { url, key } = getSupabaseConfig(env);
  const res = await fetch(`${url}/rest/v1/activity_logs`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message || body?.error || "Gagal insert activity log");
  return body;
}

async function activityExists(env, activityId) {
  if (!activityId) return false;
  const { url, key } = getSupabaseConfig(env);
  const params = new URLSearchParams({ select: "id", reference: `eq.${sanitizeText(activityId, 150)}`, limit: "1" });
  const res = await fetch(`${url}/rest/v1/activity_logs?${params}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  const rows = await res.json().catch(() => []);
  return res.ok && Array.isArray(rows) && rows.length > 0;
}


async function getUserProfile(env, userId) {
  const id = sanitizeText(userId, 100);
  if (!id || id === "developer") return null;
  const { url, key } = getSupabaseConfig(env);
  const params = new URLSearchParams({
    select: "role",
    id: `eq.${id}`,
    limit: "1",
  });
  const res = await fetch(`${url}/rest/v1/users?${params.toString()}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) return null;
  const body = await res.json().catch(() => []);
  return Array.isArray(body) ? body[0] || null : null;
}

async function supabaseGetLogs(env, query) {
  const { url, key } = getSupabaseConfig(env);
  const params = new URLSearchParams();
  const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 100);
  const offset = Math.max(Number(query.offset) || 0, 0);
  params.set("select", "*");
  params.set("order", "created_at.desc");
  params.set("limit", String(limit));
  params.set("offset", String(offset));

  if (query.module) params.set("module", `eq.${sanitizeText(query.module, 100)}`);
  if (query.action && /^[A-Z][A-Z0-9_]{1,99}$/.test(query.action)) params.set("action", `eq.${query.action}`);
  if (query.user_name) params.set("user_name", `ilike.*${sanitizeText(query.user_name, 100)}*`);
  if (query.status && ALLOWED_STATUS.has(query.status)) params.set("status", `eq.${query.status}`);
  if (query.from) params.set("created_at", `gte.${sanitizeText(query.from, 40)}`);
  if (query.to) params.append("created_at", `lte.${sanitizeText(query.to, 40)}`);
  if (query.search) {
    const term = sanitizeText(query.search, 100).replace(/[(),]/g, "");
    params.set("or", `(detail.ilike.*${term}*,reference.ilike.*${term}*,user_name.ilike.*${term}*,module.ilike.*${term}*)`);
  }

  const res = await fetch(`${url}/rest/v1/activity_logs?${params.toString()}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const body = await res.json().catch(() => []);
  if (!res.ok) throw new Error(body?.message || body?.error || "Gagal mengambil activity logs");
  return body;
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const entries = Array.isArray(body?.activities) ? body.activities.slice(0, 20) : [body];
    const inserted = [];
    for (const entry of entries) {
    const action = sanitizeText(entry?.action, 100).toUpperCase();
    const module = sanitizeText(entry?.module, 100);
    const status = sanitizeText(entry?.result || entry?.status || "SUCCESS", 20).toUpperCase();

    if (!/^[A-Z][A-Z0-9_]{1,99}$/.test(action)) return json({ success: false, message: "action tidak valid" }, 400);
    if (!module) return json({ success: false, message: "module wajib diisi" }, 400);
    if (!ALLOWED_STATUS.has(status)) return json({ success: false, message: "status tidak valid" }, 400);

    const activityId = sanitizeText(entry?.id || entry?.activityId, 150);
    if (await activityExists(env, activityId)) continue;
    const userId = sanitizeText(entry?.user_id, 100) || null;
    const sessionRole = sanitizeText(entry?.role, 120) || null;
    const profile = userId === "developer" ? null : await getUserProfile(env, userId);
    const structured = sanitizeMetadata({
      category: entry.category, page: entry.page, entityType: entry.entityType,
      entityId: entry.entityId, details: entry.details, source: entry.source,
      timestamp: entry.timestamp, sessionId: entry.sessionId ? `${String(entry.sessionId).slice(0, 6)}…` : null,
      isDeveloper: entry.isDeveloper,
    });
    const payload = {
      user_id: userId,
      user_name: sanitizeText(entry?.user || entry?.user_name, 120) || null,
      role: userId === "developer" ? "Mode Development" : sanitizeText(profile?.role, 120) || sessionRole || "User",
      action,
      module,
      detail: sanitizeText(entry?.description || entry?.detail, 1000) || null,
      reference: activityId || sanitizeText(entry?.reference, 150) || null,
      status,
      metadata: { ...sanitizeMetadata(entry?.metadata), ...structured },
    };

    const data = await supabaseInsertLog(env, payload);
    inserted.push(...(Array.isArray(data) ? data : [data]));
    }
    return json({ success: true, data: inserted, deduplicated: entries.length - inserted.length }, 201);
  } catch (err) {
    return json({ success: false, message: err?.message || "Internal server error" }, 500);
  }
}

export async function onRequestGet({ request, env }) {
  try {
    if (!isDeveloperRequest(request, env) && !await hasInventoryDeveloperAccess(request,env)) return json({ success: false, error: "Akses ditolak" }, 403);
    const url = new URL(request.url);
    const data = await supabaseGetLogs(env, Object.fromEntries(url.searchParams.entries()));
    return json({ success: true, data });
  } catch (err) {
    return json({ success: false, message: err?.message || "Internal server error" }, 500);
  }
}
