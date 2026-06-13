# ============== server.py — desarrollo local ==============
# Sirve los archivos estáticos del proyecto + proxy CORS a worldcup26.ir.
# En producción (Vercel) la misma lógica vive en api/proxy.js.
#
# Capa de resiliencia (paridad con api/proxy.js):
#   1. Intenta worldcup26.ir (timeout 8s).
#   2. Si responde OK → write-through a ./.kv_cache.json (fire-and-forget).
#   3. Si falla → lee el último snapshot de ./.kv_cache.json y lo devuelve
#      con header `X-Source: kv-fallback` + `X-Cached-At: <ISO>`.
#   4. Si tampoco hay snapshot → 502 `{ error: "no_data" }`.
#
# Uso:
#   python3 server.py
#   → http://localhost:8000

import datetime
import json
import os
import threading
import urllib.request
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

API_BASE = "https://worldcup26.ir"
PORT = 8000
HOST = "127.0.0.1"
CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".kv_cache.json")

# Mock storage para /api/predictions en local (en Vercel se usa Vercel KV).
# Cada hash64 → registro JSON. Persiste solo en memoria del proceso.
_PRED_STORE = {}

# Subpaths que se persisten en el cache local. Igual que KV_KEYS en api/proxy.js.
_CACHEABLE_SUBPATHS = {"/get/teams", "/get/games", "/get/groups", "/get/stadiums"}

# Lock + cache en memoria + persistencia en disco. El lock protege contra
# escrituras concurrentes (el server es single-threaded por request en CPython
# por el GIL, pero threading.Lock lo deja explícito y future-proof).
_cache_lock = threading.Lock()
_cache = {}


def _load_cache_from_disk():
    global _cache
    try:
        if os.path.exists(CACHE_FILE):
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                _cache = json.load(f) or {}
    except (OSError, json.JSONDecodeError) as e:
        print(f"[server] cache corrupto, ignorando: {e}")
        _cache = {}


def _save_cache_to_disk():
    try:
        tmp = CACHE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(_cache, f)
        os.replace(tmp, CACHE_FILE)
    except OSError as e:
        print(f"[server] no se pudo persistir cache: {e}")


def _cache_set(subpath, body):
    with _cache_lock:
        _cache[subpath] = {
            "body": body,
            "updated_at": datetime.datetime.utcnow().isoformat() + "Z",
        }
        _save_cache_to_disk()


def _cache_get(subpath):
    with _cache_lock:
        entry = _cache.get(subpath)
        if not entry:
            return None
        return entry.get("body"), entry.get("updated_at")


_load_cache_from_disk()


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/api/proxy/"):
            self._proxy(API_BASE + self.path[len("/api/proxy"):])
            return
        if self.path.startswith("/api/predictions"):
            self._handle_predictions("GET")
            return
        super().do_GET()

    def do_PUT(self):
        if self.path.startswith("/api/predictions"):
            self._handle_predictions("PUT")
            return
        self.send_error(405)

    def do_DELETE(self):
        if self.path.startswith("/api/predictions"):
            self._handle_predictions("DELETE")
            return
        self.send_error(405)

    def do_OPTIONS(self):
        # Preflight CORS (cubre proxy y predictions)
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def _proxy(self, target):
        subpath = target[len(API_BASE):] or "/"
        cacheable = subpath in _CACHEABLE_SUBPATHS

        # 1) Intentar upstream.
        upstream_body = None
        upstream_content_type = "application/json"
        upstream_status = None
        try:
            req = urllib.request.Request(
                target, headers={"User-Agent": "mundial-2026-local/1.0"}
            )
            with urllib.request.urlopen(req, timeout=8) as r:
                upstream_body = r.read()
                upstream_content_type = r.headers.get("Content-Type", "application/json")
                upstream_status = r.status
        except urllib.error.HTTPError as e:
            upstream_status = e.code
        except Exception:
            upstream_status = None  # network / timeout

        # 2) Upstream OK → persistir (best-effort) y devolver.
        if upstream_status == 200 and upstream_body is not None:
            if cacheable:
                try:
                    _cache_set(subpath, upstream_body.decode("utf-8", errors="replace"))
                except Exception as e:
                    print(f"[server] cache write failed: {e}")
            self._send_response(
                200,
                upstream_content_type,
                upstream_body,
                source="upstream",
            )
            return

        # 3) Upstream falló. Intentar fallback de cache local.
        if cacheable:
            cached = _cache_get(subpath)
            if cached:
                body, updated_at = cached
                self._send_response(
                    200,
                    "application/json",
                    body.encode("utf-8"),
                    source="kv-fallback",
                    cached_at=updated_at,
                )
                return

        # 4) Sin datos en ningún lado.
        payload = json.dumps({
            "error": "no_data",
            "message": f"Upstream {upstream_status} and no local cache",
            "path": subpath,
        }).encode("utf-8")
        self._send_response(502, "application/json", payload, source="none")

    def _send_response(self, status, content_type, body, source, cached_at=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("X-Source", source)
        if cached_at:
            self.send_header("X-Cached-At", cached_at)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle_predictions(self, method):
        """Mock de /api/predictions para desarrollo local. En Vercel, api/predictions.js."""
        qs = parse_qs(urlparse(self.path).query)
        # Acepta "u:<hash64>" (data) o "m:<hash64>" (metadata).
        raw = (qs.get("u") or [""])[0].lower().strip()
        if not raw or len(raw) < 66 or raw[1] != ":" or len(raw) != 66:
            self._json(400, {"error": "invalid_key"})
            return
        prefix = raw[0]
        user_hash = raw[2:]
        if prefix not in ("u", "m") or not all(c in "0123456789abcdef" for c in user_hash):
            self._json(400, {"error": "invalid_key"})
            return
        if method == "GET":
            record = _PRED_STORE.get(raw)
            if not record:
                self._json(404, {"error": "not_found"})
                return
            self._json(200, record)
        elif method == "PUT":
            length = int(self.headers.get("Content-Length") or 0)
            if length > 100 * 1024:
                self._json(413, {"error": "payload_too_large"})
                return
            raw_body = self.rfile.read(length) if length else b""
            try:
                body = json.loads(raw_body or b"{}")
            except Exception:
                self._json(400, {"error": "invalid_json"})
                return
            if not isinstance(body, dict):
                self._json(400, {"error": "invalid_json"})
                return
            record = {
                "data": body,
                "updated_at": datetime.datetime.utcnow().isoformat() + "Z",
                "version": 1,
            }
            _PRED_STORE[raw] = record
            self._json(200, {"ok": True, "updated_at": record["updated_at"]})
        elif method == "DELETE":
            _PRED_STORE.pop(raw, None)
            self._json(200, {"ok": True})
        else:
            self._json(405, {"error": "method_not_allowed"})

    def _json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        # Silenciar logs salvo errores
        if " 5" in (args[1] if len(args) > 1 else ""):
            super().log_message(format, *args)


if __name__ == "__main__":
    print(f"Mundial 2026 — http://{HOST}:{PORT}")
    print("Para parar: Ctrl+C")
    print()
    print(f"  Estáticos:    http://{HOST}:{PORT}/")
    print(f"  Proxy CORS:   http://{HOST}:{PORT}/api/proxy/get/teams")
    print(f"  Sync mock:    http://{HOST}:{PORT}/api/predictions?u=<hash64>")
    print(f"  Cache local:  {CACHE_FILE}")
    print()
    HTTPServer((HOST, PORT), Handler).serve_forever()
