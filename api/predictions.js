// ============== api/predictions.js — Vercel Node.js serverless function ==============
// Persistencia de quiniela por usuario (hash de email + PIN opcional).
// Storage: Vercel KV (Redis) — 256MB gratis, ~2.5M usuarios.
//
// Endpoints:
//   GET    /api/predictions?u=<hash64>  → 200 { data, updated_at } | 404
//   PUT    /api/predictions?u=<hash64>  → 200 { ok, updated_at }   (body: { data })
//   DELETE /api/predictions?u=<hash64>  → 200 { ok }
//
// Variables de entorno requeridas (Vercel las inyecta al conectar Vercel KV):
//   - KV_REST_API_URL
//   - KV_REST_API_TOKEN
//
// Si no están configuradas → 503 "kv_unavailable" (cliente cae a local).

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store",
};

const MAX_BODY_BYTES = 100 * 1024;
const HASH_REGEX = /^[a-f0-9]{64}$/;
const KV_KEY_PREFIX = "u:";

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

async function kvGet(key) {
  const url = `${process.env.KV_REST_API_URL}/${encodeURIComponent(key)}`;
  const r = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
    signal: AbortSignal.timeout(8000),
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`kv_get_${r.status}`);
  return r.json();
}

async function kvSet(key, value) {
  const url = `${process.env.KV_REST_API_URL}/${encodeURIComponent(key)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(value),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`kv_set_${r.status}`);
  return r.json();
}

async function kvDel(key) {
  const url = `${process.env.KV_REST_API_URL}/${encodeURIComponent(key)}/`;
  // La API de Vercel KV acepta `?` para DEL. Alternativamente, usamos POST con EX.
  // Probamos el método estándar: POST a /<key> con `?` no — usamos el endpoint de DEL.
  const r = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
    signal: AbortSignal.timeout(8000),
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`kv_del_${r.status}`);
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

  // Verificar que Vercel KV esté configurado
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
