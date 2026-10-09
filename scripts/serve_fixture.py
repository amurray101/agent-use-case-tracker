#!/usr/bin/env python3
"""Serve the site with fixtures/ mounted at /data/.

    python3 scripts/make_fixture.py
    python3 scripts/serve_fixture.py

Does not read or write data/.
"""

from __future__ import annotations

import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "fixtures"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path.startswith("/data/"):
            rel = path[len("/data/") :]
            target = (FIXTURES / rel).resolve()
            root = FIXTURES.resolve()
            if target != root and root not in target.parents:
                self.send_error(403)
                return
            if not target.is_file():
                self.send_error(404)
                return
            body = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the site using fixtures/ as data/.")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    if not (FIXTURES / "index.json").is_file():
        raise SystemExit("No fixtures/. Run python3 scripts/make_fixture.py first.")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"http://127.0.0.1:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
