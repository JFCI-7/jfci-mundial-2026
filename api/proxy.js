// ============== api/proxy.js — Vercel Node.js serverless function ==============
// Proxy CORS para worldcup26.ir + capa de "last good response" en Vercel KV.
// Vercel detecta automáticamente este archivo en /api y lo expone en /api/proxy.
// Rutas: /api/proxy/get/teams, /api/proxy/get/games, /api/proxy/get/groups, etc.
//
// Capa de resiliencia:
//   1. Intenta worldcup26.ir (timeout 8s).
//   2. Si responde OK → write-through a Vercel KV (fire-and-forget) y devuelve body.
//   3. Si falla (red / 5xx / timeout) → lee el último snapshot de KV y lo devuelve
//      con header `X-Source: kv-fallback` + `X-Cached-At: <ISO>`.
//   4. Si tampoco hay snapshot → 502 `{ error: "no_data" }`.
//
// El cliente (`api.js`) captura los headers X-Source / X-Cached-At y los expone
// via `API.getSource()` y `API.getCachedAt()` para que `app.js` muestre un badge.
//
// Implementado en Node.js (en lugar de Python) para máxima compatibilidad con
// Vercel Serverless Functions, que detecta runtimes Node.js automáticamente.

const API = "https://worldcup26.ir";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Cache-Control": "no-store",
};

// Mapea cada subpath cacheable a la key que usamos en Vercel KV.
// Solo los 4 endpoints que consume el cliente. Cualquier otra ruta (e.g. /docs)
// se proxya sin caché.
const KV_KEYS = {
  "/get/teams":    "wc26:teams",
  "/get/games":    "wc26:games",
  "/get/groups":   "wc26:groups",
  "/get/stadiums": "wc26:stadiums",
};

const KV_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 días. Es solo "last good" — sobreescribimos en cada éxito.

// ==== Upstash REST (mismo patrón que api/predictions.js) ====
function kvBase() {
  return (process.env.KV_REST_API_URL || "").replace(/\/+$/, "");
}

function kvAvailable() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function kvGet(key) {
  const r = await fetch(`${kvBase()}/get/${encodeURIComponent(key)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
    signal: AbortSignal.timeout(4000),
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`kv_get_${r.status}`);
  const json = await r.json();
  // Upstash devuelve { result: "<string>" } si guardamos string,
  // o el objeto directo si guardamos JSON. Manejamos ambos.
  if (json && typeof json.result === "string") {
    try { return { body: json.result, storedAs: "string" }; } catch { return null; }
  }
  if (json && json.result !== undefined) {
    return { body: JSON.stringify(json.result), storedAs: "object" };
  }
  return null;
}

async function kvSet(key, value) {
  // Guardamos el body como string (Upstash lo persiste en /set/<key>/<urlencoded>).
  const encodedValue = encodeURIComponent(value);
  const r = await fetch(
    `${kvBase()}/set/${encodeURIComponent(key)}/${encodedValue}?EX=${KV_TTL_SECONDS}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
      signal: AbortSignal.timeout(4000),
    }
  );
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`kv_set_${r.status}: ${body.slice(0, 200)}`);
  }
  return r.json();
}

function withSource(headers, source, cachedAt) {
  const out = { ...CORS_HEADERS, ...headers, "X-Source": source };
  if (cachedAt) out["X-Cached-At"] = cachedAt;
  return out;
}

export default async function handler(request) {
  // Manejar preflight CORS
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Extraer subpath después de /api/proxy
  const url = new URL(request.url);
  const subpath = url.pathname.replace(/^\/api\/proxy/, "") || "/";
  const target = API + subpath;
  const kvKey = KV_KEYS[subpath];

  // 1) Intentar upstream.
  let upstream;
  try {
    upstream = await fetch(target, {
      method: "GET",
      headers: { "User-Agent": "mundial-2026-vercel/1.0" },
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    // Error de red o timeout → cae al fallback de KV.
    upstream = null;
  }

  // 2) Si el upstream respondió OK, persistir (best-effort) y devolver.
  if (upstream && upstream.ok) {
    const body = await upstream.text();
    const contentType = upstream.headers.get("Content-Type") || "application/json";
    // Fire-and-forget: no bloqueamos la respuesta al cliente por el write.
    if (kvKey && kvAvailable()) {
      kvSet(kvKey, body).catch((e) => {
        console.warn(`[proxy] KV write failed for ${kvKey}:`, e.message);
      });
    }
    return new Response(body, {
      status: 200,
      headers: withSource({ "Content-Type": contentType }, "upstream"),
    });
  }

  // 3) Upstream falló (red, timeout, o !ok). Intentar fallback de KV.
  if (kvKey && kvAvailable()) {
    try {
      const cached = await kvGet(kvKey);
      if (cached && cached.body) {
        return new Response(cached.body, {
          status: 200,
          headers: withSource(
            { "Content-Type": "application/json" },
            "kv-fallback",
            new Date().toISOString()
          ),
        });
      }
    } catch (e) {
      console.warn(`[proxy] KV read failed for ${kvKey}:`, e.message);
    }
  }

  // 4) Sin datos en ningún lado. 502 explícito para que el cliente muestre su banner.
  const upstreamStatus = upstream ? upstream.status : "network";
  const payload = JSON.stringify({
    error: "no_data",
    message: `Upstream ${upstreamStatus} and no KV snapshot available`,
    path: subpath,
  });
  return new Response(payload, {
    status: 502,
    headers: withSource({ "Content-Type": "application/json" }, "none"),
  });
}

// Vercel espera un objeto con config y un handler
export const config = {
  runtime: "edge",
};
