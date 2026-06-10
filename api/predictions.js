// ============== api/predictions.js — Vercel Node.js serverless function ==============
// Persistencia de quiniela por usuario (hash de email + PIN opcional).
// Storage: Vercel KV / Upstash Redis — 256MB gratis, ~2.5M usuarios.
//
// Endpoints (cliente):
//   GET    /api/predictions?u=<hash64>  → 200 { data, updated_at, version } | 404
//   PUT    /api/predictions?u=<hash64>  → 200 { ok, updated_at }
//   DELETE /api/predictions?u=<hash64>  → 200 { ok }
//
// Variables de entorno (inyectadas por Vercel al conectar Vercel KV o
// Upstash for Redis integration):
//   - KV_REST_API_URL    → Upstash REST endpoint
//   - KV_REST_API_TOKEN  → bearer token
//
// Si no están configuradas → 503 "kv_unavailable" (cliente cae a local).
//
// API REST de Upstash:
//   GET    {base}/get/{key}                 → { result: "<stringified-json>" } | 404
//   POST   {base}/set/{key}/{value}?EX=N    → { result: "OK" }
//   POST   {base}/del/{key}                 → { result: 1 }
// (Upstash solo acepta GET/POST en REST. DELETE no es soportado por el gateway.)

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store",
};

const MAX_BODY_BYTES = 100 * 1024;
const HASH_REGEX = /^[a-f0-9]{64}$/;
const KV_KEY_PREFIX = "u:";
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 365; // 1 año

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function getHashFromUrl(request) {
  const url = new URL(request.url);
  const hash = url.searchParams.get("u") || "";
  return hash.toLowerCase().trim();
}

function kvBase() {
  return (process.env.KV_REST_API_URL || "").replace(/\/+$/, "");
}

// ==== Upstash REST ====
async function kvGet(key) {
  const r = await fetch(`${kvBase()}/get/${encodeURIComponent(key)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
    signal: AbortSignal.timeout(8000),
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`kv_get_${r.status}`);
  const json = await r.json();
  // Upstash devuelve { result: "<JSON string>" }. Upstash también puede devolver
  // directamente el objeto si el value es un JSON object, pero la forma más
  // confiable es stringificar en el SET y parsear aquí.
  if (json && typeof json.result === "string") {
    try { return JSON.parse(json.result); } catch { return json.result; }
  }
  return json && json.result !== undefined ? json.result : null;
}

async function kvSet(key, value, ttlSeconds = DEFAULT_TTL_SECONDS) {
  // SET key value EX ttl — payload como string JSON en la URL path.
  // (Upstash REST acepta el value URL-encoded en el path.)
  const encodedValue = encodeURIComponent(JSON.stringify(value));
  const r = await fetch(
    `${kvBase()}/set/${encodeURIComponent(key)}/${encodedValue}?EX=${ttlSeconds}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
      signal: AbortSignal.timeout(8000),
    }
  );
  if (!r.ok) {
    let body = "";
    try { body = await r.text(); } catch {}
    throw new Error(`kv_set_${r.status}: ${body.slice(0, 200)}`);
  }
  return r.json();
}

async function kvDel(key) {
  const r = await fetch(`${kvBase()}/del/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
    signal: AbortSignal.timeout(8000),
  });
  if (r.status === 404) return null;
  if (!r.ok) {
    let body = "";
    try { body = await r.text(); } catch {}
    throw new Error(`kv_del_${r.status}: ${body.slice(0, 200)}`);
  }
  return r.json();
}

function validatePayload(body) {
  if (!body || typeof body !== "object") return "invalid_json";
  if (!Array.isArray(body.predictions)) body.predictions = [];
  if (!Array.isArray(body.user_scores)) body.user_scores = [];
  if (!Array.isArray(body.notes)) body.notes = [];
  if (typeof body.preferences !== "object" || body.preferences === null) body.preferences = {};
  if (body.predictions.length > 200) return "too_many_predictions";
  if (body.user_scores.length > 200) return "too_many_scores";
  if (body.notes.length > 200) return "too_many_notes";
  return null;
}

export default async function handler(request) {
  // Preflight CORS
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Verificar que Vercel KV / Upstash esté configurado
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return jsonResponse(503, { error: "kv_unavailable", message: "Sync not configured" });
  }

  const hash = getHashFromUrl(request);
  if (!HASH_REGEX.test(hash)) {
    return jsonResponse(400, { error: "invalid_hash" });
  }

  const key = `${KV_KEY_PREFIX}${hash}`;

  try {
    if (request.method === "GET") {
      const value = await kvGet(key);
      if (!value) return jsonResponse(404, { error: "not_found" });
      return jsonResponse(200, value);
    }

    if (request.method === "PUT") {
      const contentLength = parseInt(request.headers.get("content-length") || "0", 10);
      if (contentLength > MAX_BODY_BYTES) {
        return jsonResponse(413, { error: "payload_too_large" });
      }
      const rawText = await request.text();
      if (rawText.length > MAX_BODY_BYTES) {
        return jsonResponse(413, { error: "payload_too_large" });
      }
      let body;
      try {
        body = JSON.parse(rawText);
      } catch {
        return jsonResponse(400, { error: "invalid_json" });
      }
      const validationError = validatePayload(body);
      if (validationError) {
        return jsonResponse(400, { error: validationError });
      }
      const record = {
        data: body,
        updated_at: new Date().toISOString(),
        version: 1,
      };
      await kvSet(key, record);
      return jsonResponse(200, { ok: true, updated_at: record.updated_at });
    }

    if (request.method === "DELETE") {
      await kvDel(key);
      return jsonResponse(200, { ok: true });
    }

    return jsonResponse(405, { error: "method_not_allowed" });
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    return jsonResponse(502, { error: "upstream_error", message });
  }
}

export const config = {
  runtime: "edge",
};
