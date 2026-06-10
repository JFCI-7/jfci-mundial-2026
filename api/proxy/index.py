# ============== api/proxy.py — Vercel Python function ==============
# Proxy CORS para worldcup26.ir.
# Vercel detecta automáticamente este archivo en /api y lo expone en /api/proxy.
# Rutas: /api/proxy/get/teams, /api/proxy/get/games, /api/proxy/get/groups, etc.

from urllib.request import urlopen, Request, HTTPError, URLError
import json

API = "https://worldcup26.ir"


def handler(request):
    try:
        # request.path será /api/proxy/get/teams → quitamos /api/proxy
        path = getattr(request, "path", "/")
        target = API + path.replace("/api/proxy", "")

        # Manejar preflight CORS
        method = getattr(request, "method", "GET").upper()
        if method == "OPTIONS":
            return _cors_response(204, b"")

        # Hacer fetch a la API upstream
        req = Request(target, headers={"User-Agent": "mundial-2026-vercel/1.0"})
        try:
            with urlopen(req, timeout=8) as r:
                body = r.read()
                content_type = r.headers.get("Content-Type", "application/json")
                return {
                    "statusCode": 200,
                    "headers": _cors_headers(content_type),
                    "body": body.decode("utf-8", errors="replace"),
                }
        except HTTPError as e:
            return _error_response(e.code, f"upstream {e.code}: {e.reason}")
        except URLError as e:
            return _error_response(502, f"upstream unreachable: {e.reason}")
    except Exception as e:
        return _error_response(500, f"{type(e).__name__}: {e}")


def _cors_headers(content_type="application/json"):
    return {
        "Content-Type": content_type,
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Cache-Control": "no-store",
    }


def _cors_response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": _cors_headers(),
        "body": body.decode("utf-8", errors="replace") if isinstance(body, bytes) else (body or ""),
    }


def _error_response(status_code, message):
    return {
        "statusCode": status_code,
        "headers": _cors_headers(),
        "body": json.dumps({"error": "proxy_error", "message": message}),
    }
