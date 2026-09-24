#!/usr/bin/env python3
"""Loopback static Host server with atomic, revisioned round-log storage."""

import json
import os
import re
import sys
import tempfile
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
SESSIONS = ROOT / "sessions"
SESSION_ID = re.compile(r"^[0-9a-f]{32}$")
WRITE_LOCK = threading.Lock()
PENDING_ENDS = {}
MAX_BYTES = 25 * 1024 * 1024


class HostHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _path(self):
        return unquote(urlsplit(self.path).path)

    def _json_error(self, code, message):
        body = json.dumps({"error": message}).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self._path()
        if path.startswith("/sessions"):
            self._json_error(404, "Not found")
            return
        if path.startswith("/api/session/"):
            session_id = path[len("/api/session/"):]
            if not SESSION_ID.fullmatch(session_id):
                self._json_error(404, "Not found")
                return
            file = SESSIONS / f"{session_id}.json"
            try:
                data = file.read_bytes()
            except FileNotFoundError:
                self._json_error(404, "Log not found")
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Disposition", f'attachment; filename="{session_id}.json"')
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
            return
        if path.startswith("/api/"):
            self._json_error(404, "Not found")
            return
        super().do_GET()

    def do_POST(self):
        endpoint = self._path()
        if endpoint not in ("/api/session", "/api/session/end"):
            self._json_error(404, "Not found")
            return
        origin = self.headers.get("Origin")
        if origin and origin not in (f"http://127.0.0.1:{self.server.server_port}", f"http://localhost:{self.server.server_port}"):
            self._json_error(403, "Wrong origin")
            return
        if self.headers.get_content_type() != "application/json":
            self._json_error(415, "Expected JSON")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if not 0 < length <= MAX_BYTES:
            self._json_error(413, "Log too large or empty")
            return
        try:
            document = json.loads(self.rfile.read(length))
        except (ValueError, UnicodeDecodeError):
            self._json_error(400, "Invalid JSON")
            return
        if not isinstance(document, dict) or not SESSION_ID.fullmatch(str(document.get("sessionId", ""))):
            self._json_error(400, "Invalid session document")
            return
        if endpoint == "/api/session/end":
            ended_at = document.get("endedAt")
            if not isinstance(ended_at, str) or not 20 <= len(ended_at) <= 35:
                self._json_error(400, "Invalid end time")
                return
            session_id = document["sessionId"]
            with WRITE_LOCK:
                SESSIONS.mkdir(exist_ok=True)
                path = SESSIONS / f"{session_id}.json"
                if path.exists():
                    existing = json.loads(path.read_text(encoding="utf-8"))
                    existing["endedAt"] = ended_at
                    existing["updatedAt"] = ended_at
                    self._write_document(path, existing)
                else:
                    PENDING_ENDS[session_id] = ended_at
            self.send_response(204)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return
        if document.get("schemaVersion") != 1:
            self._json_error(400, "Invalid schema version")
            return
        revision = document.get("revision")
        if type(revision) is not int or revision < 1 or not isinstance(document.get("events"), list):
            self._json_error(400, "Invalid revision or events")
            return
        session_id = document["sessionId"]
        path = SESSIONS / f"{session_id}.json"
        with WRITE_LOCK:
            SESSIONS.mkdir(exist_ok=True)
            prior_end = PENDING_ENDS.pop(session_id, None)
            if path.exists():
                try:
                    old = json.loads(path.read_text(encoding="utf-8"))
                    prior_end = old.get("endedAt") or prior_end
                    if old.get("revision", 0) >= revision:
                        self.send_response(204)
                        self.send_header("Cache-Control", "no-store")
                        self.end_headers()
                        return
                except (ValueError, OSError):
                    pass
            if prior_end and not document.get("endedAt"):
                document["endedAt"] = prior_end
            self._write_document(path, document)
        self.send_response(204)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    @staticmethod
    def _write_document(path, document):
        temp_path = None
        try:
            with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=SESSIONS, prefix=".session-", suffix=".tmp", delete=False) as temp:
                temp_path = Path(temp.name)
                json.dump(document, temp, ensure_ascii=False, indent=2)
                temp.write("\n")
                temp.flush()
                os.fsync(temp.fileno())
            os.replace(temp_path, path)
        finally:
            if temp_path and temp_path.exists():
                temp_path.unlink()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    url = f"http://127.0.0.1:{port}/"
    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), HostHandler)
    except OSError as error:
        sys.exit(f"Could not start the Host server on port {port}: {error}")
    print(f"Host page: {url}", flush=True)
    print(f"Session logs: {SESSIONS}", flush=True)
    print("Press Ctrl+C to stop the server.", flush=True)
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
