# ============== server.py — desarrollo local ==============
# Sirve los archivos estáticos del proyecto + proxy CORS a worldcup26.ir.
# En producción (Vercel) la misma lógica vive en api/proxy.py.
#
# Uso:
#   python3 server.py
#   → http://localhost:8000
#
# Detecta el protocolo de la URL para que /api/proxy/* funcione tanto en
# HTTP (local) como en HTTPS (Vercel). El browser hace fetch con origin
# http://localhost:8000 → el server responde con CORS header.

import urllib.request
from http.server import HTTPServer, SimpleHTTPRequestHandler

API_BASE = "https://worldcup26.ir"
PORT = 8000
HOST = "127.0.0.1"


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/api/proxy/"):
            self._proxy(API_BASE + self.path[len("/api/proxy"):])
            return
        super().do_GET()

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

    def do_OPTIONS(self):
        # Preflight CORS
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
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
    print()
    HTTPServer((HOST, PORT), Handler).serve_forever()
