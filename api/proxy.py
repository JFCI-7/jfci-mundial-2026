# ============== api/proxy.py — Vercel Python function ==============
# Misma lógica que server.py pero para Vercel Serverless Functions.
# Vercel detecta automáticamente este archivo en /api y lo expone en /api/proxy.
# Rutas: /api/proxy/get/teams, /api/proxy/get/games, /api/proxy/get/groups, etc.

from urllib.request import urlopen, Request
from http.server import BaseHTTPRequestHandler

API = "https://worldcup26.ir"


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # self.path será /api/proxy/get/teams → quitamos /api/proxy
        target = API + self.path.replace("/api/proxy", "")
        try:
            req = Request(target, headers={"User-Agent": "mundial-2026-vercel/1.0"})
            with urlopen(req, timeout=10) as r:
                body = r.read()
                content_type = r.headers.get("Content-Type", "application/json")
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        except Exception as e:
            self.send_response(502)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(f'{{"error":"{type(e).__name__}","message":"{e}"}}'.encode())

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def log_message(self, format, *args):
        pass
