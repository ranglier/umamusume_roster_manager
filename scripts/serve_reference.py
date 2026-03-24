#!/usr/bin/env python3

from __future__ import annotations

import argparse
import errno
import functools
import http.server
import json
import socket
import socketserver
import sys
import webbrowser
from pathlib import Path

from lib.gametora_reference import update_umamusume_reference


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DIST_ROOT = PROJECT_ROOT / "dist"
REFERENCE_META_PATH = DIST_ROOT / "data" / "reference-meta.json"


class ReferenceRequestHandler(http.server.SimpleHTTPRequestHandler):
    server_version = "UmamusumeReferenceHTTP/1.0"

    def end_headers(self) -> None:
        if self.path in ("/", "/index.html"):
            self.send_header("Cache-Control", "no-store")
        elif self.path.startswith("/data/"):
            self.send_header("Cache-Control", "no-cache")
        else:
            self.send_header("Cache-Control", "public, max-age=3600")
        super().end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/__health":
            self._send_json(
                {
                    "status": "ok",
                    "dist_exists": DIST_ROOT.exists(),
                    "reference_meta_exists": REFERENCE_META_PATH.exists(),
                }
            )
            return

        if self.path == "/__meta":
            if not REFERENCE_META_PATH.exists():
                self.send_error(404, "Reference metadata not found. Run the update command first.")
                return

            self._send_json(json.loads(REFERENCE_META_PATH.read_text(encoding="utf-8-sig")))
            return

        super().do_GET()

    def list_directory(self, path: str):  # type: ignore[override]
        self.send_error(403, "Directory listing is disabled.")
        return None

    def _send_json(self, payload: object) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class ThreadingTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Serve the generated local reference bundle over HTTP for browser compatibility."
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Host interface to bind. Default: 127.0.0.1",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="TCP port to bind. Default: 8000",
    )
    parser.add_argument(
        "--open",
        action="store_true",
        help="Open the local reference in the default browser after the server starts.",
    )
    parser.add_argument(
        "--update-first",
        action="store_true",
        help="Run the reference update pipeline before starting the server.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if args.update_first:
        print("Running local reference update before starting the server...")
        summary = update_umamusume_reference(force=False)
        print("")
        print("Update complete.")
        print(f"Raw datasets synced : {summary['rawDatasetCount']}")
        print(f"Normalized entities : {summary['normalizedEntityCount']}")
        print(f"Visual assets       : {summary['assetCount']}")
        print(f"Asset failures      : {summary['assetFailureCount']}")
        print(f"App output          : {summary['appEntry']}")
        print("")

    if not DIST_ROOT.exists():
        print("Missing dist/ bundle. Run `python ./scripts/update_reference.py` first.", file=sys.stderr)
        return 1

    handler = functools.partial(ReferenceRequestHandler, directory=str(DIST_ROOT))

    try:
        httpd = ThreadingTCPServer((args.host, args.port), handler)
    except OSError as exc:
        if exc.errno == errno.EADDRINUSE:
            print(
                f"Port {args.port} is already in use on {args.host}. "
                "Choose another port with `--port`.",
                file=sys.stderr,
            )
            return 1
        raise

    with httpd:
        url = f"http://{args.host}:{args.port}/"
        print(f"Serving local reference at {url}")
        print(f"Health endpoint: {url}__health")
        print(f"Metadata endpoint: {url}__meta")
        print("Press Ctrl+C to stop.")

        if args.open:
            webbrowser.open(url)

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
