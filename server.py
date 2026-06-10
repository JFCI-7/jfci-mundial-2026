# ============== server.py — desarrollo local ==============
# Sirve los archivos estáticos del proyecto + proxy CORS a worldcup26.ir.
# En producción (Vercel) la misma lógica vive en api/proxy.js.
#
# Uso:
#   python3 server.py
#   → http://localhost:8000
#
# Detecta el protocolo de la URL para que /api/proxy/* funcione tanto en
# HTTP (local) como en HTTPS (Vercel). El browser hace fetch con origin
# http://localhost:8000 → el server responde con CORS header.

import json
import urllib.request
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

API_BASE = "https://worldcup26.ir"
PORT = 8000
HOST = "127.0.0.1"

# Mock storage para /api/predictions en local (en Vercel se usa Vercel KV).
# Cada hash64 → registro JSON. Persiste solo en memoria del proceso.
_PRED_STORE = {}


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
        try:
            req = urllib.request.Request(target, headers={"User-Agent": "mundial-2026-local/1.0"})
            with urllib.request.urlopen(req, timeout=10) as r:
                body = r.read()
                content_type = r.headers.get("Content-Type", "application/json")
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(f'{{"error":"upstream {e.code}","path":"{target}"}}'.encode())
        except Exception as e:
            self.send_response(502)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(f'{{"error":"{type(e).__name__}","message":"{e}"}}'.encode())

    def _handle_predictions(self, method):
        """Mock de /api/predictions para desarrollo local. En Vercel, api/predictions.js."""
        qs = parse_qs(urlparse(self.path).query)
        user_hash = (qs.get("u") or [""])[0].lower().strip()
        if not user_hash or len(user_hash) != 64 or not all(c in "0123456789abcdef" for c in user_hash):
            self._json(400, {"error": "invalid_hash"})
            return
        if method == "GET":
            record = _PRED_STORE.get(user_hash)
            if not record:
                self._json(404, {"error": "not_found"})
                return
            self._json(200, record)
        elif method == "PUT":
            length = int(self.headers.get("Content-Length") or 0)
            if length > 100 * 1024:
                self._json(413, {"error": "payload_too_large"})
                return
            raw = self.rfile.read(length) if length else b""
            try:
                body = json.loads(raw or b"{}")
            except Exception:
                self._json(400, {"error": "invalid_json"})
                return
            if not isinstance(body, dict):
                self._json(400, {"error": "invalid_json"})
                return
            import datetime
            record = {
                "data": body,
                "updated_at": datetime.datetime.utcnow().isoformat() + "Z",
                "version": 1,
            }
            _PRED_STORE[user_hash] = record
            self._json(200, {"ok": True, "updated_at": record["updated_at"]})
        elif method == "DELETE":
            _PRED_STORE.pop(user_hash, None)
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

    def do_OPTIONS(self):
        # Preflight CORS
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

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
    print()
    HTTPServer((HOST, PORT), Handler).serve_forever()
