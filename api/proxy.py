from urllib.request import urlopen, Request
import json

API = "https://worldcup26.ir"

def handler(request):
    path = getattr(request, "path", "/")
    target = API + path.replace("/api/proxy", "")
    try:
        with urlopen(Request(target, headers={"User-Agent": "mundial-2026-vercel/1.0"}), timeout=8) as r:
            body = r.read()
            return {
                "statusCode": 200,
                "headers": {
                    "Content-Type": r.headers.get("Content-Type", "application/json"),
                    "Access-Control-Allow-Origin": "*",
                    "Cache-Control": "no-store",
                },
                "body": body.decode("utf-8", errors="replace"),
            }
    except Exception as e:
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            "body": json.dumps({"error": str(e)}),
        }
