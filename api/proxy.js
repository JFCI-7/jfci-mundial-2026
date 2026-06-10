// ============== api/proxy.js — Vercel Node.js serverless function ==============
// Proxy CORS para worldcup26.ir.
// Vercel detecta automáticamente este archivo en /api y lo expone en /api/proxy.
// Rutas: /api/proxy/get/teams, /api/proxy/get/games, /api/proxy/get/groups, etc.
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

export default async function handler(request) {
  // Manejar preflight CORS
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Extraer subpath después de /api/proxy
  const url = new URL(request.url);
  const subpath = url.pathname.replace(/^\/api\/proxy/, "") || "/";
  const target = API + subpath;

  try {
    const upstream = await fetch(target, {
      method: "GET",
      headers: { "User-Agent": "mundial-2026-vercel/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    const body = await upstream.text();
    const contentType = upstream.headers.get("Content-Type") || "application/json";
    return new Response(body, {
      status: upstream.status,
      headers: { ...CORS_HEADERS, "Content-Type": contentType },
    });
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: "proxy_error", message }),
      { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
}

// Vercel espera un objeto con config y un handler
export const config = {
  runtime: "edge",
};
