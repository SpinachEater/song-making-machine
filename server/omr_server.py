#!/usr/bin/env python3
"""Sheet music recognition server for the Photo to Sheet Music module.

The web page sends photos of sheet music here; this server runs an optical
music recognition (OMR) engine on them and sends back MusicXML.

    POST /recognize   body: {"pages": ["data:image/jpeg;base64,...", ...]}
                      reply: {"musicxml": "<?xml ...", "engine": "homr", "seconds": 12.3}
    GET  /health      reply: {"ok": true, "engine": "homr"}

Engines are swappable (see ENGINES below). The default, homr
(https://github.com/liebharc/homr, AGPL-3.0), is run unmodified as a separate
command, so this server only talks to it through files.

Run:  python3 server/omr_server.py            (listens on http://localhost:8765)
      OMR_PORT=9000 OMR_ENGINE=homr python3 server/omr_server.py
"""
import base64
import binascii
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_PAGES = int(os.environ.get("OMR_MAX_PAGES", "10"))
MAX_PAGE_BYTES = int(os.environ.get("OMR_MAX_PAGE_MB", "15")) * 1024 * 1024
TIMEOUT_PER_PAGE = int(os.environ.get("OMR_TIMEOUT_PER_PAGE", "300"))
# Comma-separated list of web origins allowed to call this server, or * for any.
ALLOWED_ORIGINS = os.environ.get("OMR_ALLOWED_ORIGINS", "*")

EXT = {b"\xff\xd8\xff": ".jpg", b"\x89PNG": ".png", b"RIFF": ".webp"}


class RecognitionError(Exception):
    def __init__(self, message, status=422):
        super().__init__(message)
        self.status = status


def homr_command():
    exe = os.environ.get("HOMR_BIN") or shutil.which("homr")
    if exe:
        return [exe]
    return [sys.executable, "-m", "homr.main"]


def recognize_homr(paths, workdir):
    """Runs homr on each page in order and merges the pages into one score."""
    scores = []
    for p in paths:
        try:
            run = subprocess.run(
                homr_command() + [p], cwd=workdir, capture_output=True, text=True,
                timeout=TIMEOUT_PER_PAGE,
            )
        except subprocess.TimeoutExpired:
            raise RecognitionError("Reading one of the pages took too long. Try a sharper, closer photo.")
        out = os.path.splitext(p)[0] + ".musicxml"
        if run.returncode != 0 or not os.path.exists(out):
            tail = (run.stderr or run.stdout or "").strip().splitlines()[-3:]
            sys.stderr.write("homr failed on %s:\n%s\n" % (p, "\n".join(tail)))
            raise RecognitionError(
                "No music could be read on page %d. Make sure the whole page is in the photo, "
                "flat, in focus and well lit." % (paths.index(p) + 1))
        with open(out, encoding="utf-8") as f:
            scores.append(f.read())
    return merge_pages(scores)


def merge_pages(scores):
    """Joins single-page MusicXML scores (same parts) into one, renumbering measures."""
    if len(scores) == 1:
        return scores[0]
    import xml.etree.ElementTree as ET

    trees = [ET.fromstring(s.encode("utf-8")) for s in scores]
    first = trees[0]
    parts = first.findall("part")
    counts = [len(p.findall("measure")) for p in parts]
    for t in trees[1:]:
        for i, part in enumerate(t.findall("part")):
            if i >= len(parts):
                break  # a page with an extra staff: keep the parts from page one
            for m in part.findall("measure"):
                counts[i] += 1
                m.set("number", str(counts[i]))
                parts[i].append(m)
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(first, encoding="unicode")


ENGINES = {"homr": recognize_homr}
ENGINE = os.environ.get("OMR_ENGINE", "homr")
busy = threading.Lock()


def decode_pages(body):
    try:
        data = json.loads(body)
    except ValueError:
        raise RecognitionError("The request was not valid JSON.", 400)
    pages = data.get("pages") if isinstance(data, dict) else None
    if not isinstance(pages, list) or not pages:
        raise RecognitionError("Send at least one photo.", 400)
    if len(pages) > MAX_PAGES:
        raise RecognitionError("Send at most %d pages at a time." % MAX_PAGES, 400)
    out = []
    for item in pages:
        if not isinstance(item, str):
            raise RecognitionError("Each page must be an image.", 400)
        b64 = item.split(",", 1)[1] if item.startswith("data:") else item
        try:
            raw = base64.b64decode(b64, validate=True)
        except (binascii.Error, ValueError):
            raise RecognitionError("One of the photos could not be read.", 400)
        if len(raw) > MAX_PAGE_BYTES:
            raise RecognitionError("One of the photos is too large.", 413)
        ext = next((e for sig, e in EXT.items() if raw.startswith(sig)), None)
        if not ext:
            raise RecognitionError("Photos must be JPEG, PNG or WebP.", 415)
        out.append((raw, ext))
    return out


class Handler(BaseHTTPRequestHandler):
    server_version = "SongMakingMachineOMR/1.0"

    def cors(self):
        origin = self.headers.get("Origin")
        allowed = [o.strip() for o in ALLOWED_ORIGINS.split(",")]
        if "*" in allowed:
            self.send_header("Access-Control-Allow-Origin", "*")
        elif origin in allowed:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        # Lets pages on https sites reach a server on this computer (Chrome private network access)
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def reply(self, status, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self):
        if self.path.rstrip("/") in ("", "/health"):
            return self.reply(200, {"ok": True, "engine": ENGINE, "busy": busy.locked()})
        self.reply(404, {"error": "Not found"})

    def do_POST(self):
        if self.path.rstrip("/") != "/recognize":
            return self.reply(404, {"error": "Not found"})
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_PAGES * MAX_PAGE_BYTES * 4 // 3 + 4096:
            return self.reply(413, {"error": "The photos are too large."})
        body = self.rfile.read(length)
        if not busy.acquire(timeout=1):
            return self.reply(503, {"error": "The server is reading another score. Try again in a minute."})
        workdir = tempfile.mkdtemp(prefix="omr-")
        try:
            pages = decode_pages(body)
            paths = []
            for i, (raw, ext) in enumerate(pages):
                p = os.path.join(workdir, "page%02d%s" % (i + 1, ext))
                with open(p, "wb") as f:
                    f.write(raw)
                paths.append(p)
            t0 = time.time()
            xml = ENGINES[ENGINE](paths, workdir)
            self.reply(200, {"musicxml": xml, "engine": ENGINE, "pages": len(paths),
                             "seconds": round(time.time() - t0, 1)})
        except RecognitionError as e:
            self.reply(e.status, {"error": str(e)})
        except Exception as e:  # keep the server up, report a plain message
            sys.stderr.write("recognition failed: %r\n" % e)
            self.reply(500, {"error": "Something went wrong while reading the music."})
        finally:
            busy.release()
            shutil.rmtree(workdir, ignore_errors=True)


def main():
    if ENGINE not in ENGINES:
        sys.exit("Unknown OMR_ENGINE %r. Choose one of: %s" % (ENGINE, ", ".join(ENGINES)))
    host = os.environ.get("OMR_HOST", "127.0.0.1")
    port = int(os.environ.get("OMR_PORT", os.environ.get("PORT", "8765")))
    srv = ThreadingHTTPServer((host, port), Handler)
    print("Sheet music reader (%s) listening on http://%s:%d" % (ENGINE, host, port), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
