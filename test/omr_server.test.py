"""Tests the reader server's request checks and page merging (no OMR engine needed).

    python3 test/omr_server.test.py
"""
import base64
import json
import os
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))
import omr_server as S  # noqa: E402

FX = os.path.join(os.path.dirname(__file__), "fixtures")
failed = 0


def check(name, ok, detail=""):
    global failed
    print(("PASS" if ok else "FAIL") + "  " + name + ("  " + detail if detail else ""))
    failed += 0 if ok else 1


def err(body):
    try:
        S.decode_pages(body)
        return None
    except S.RecognitionError as e:
        return e.status, str(e)


jpg = open(os.path.join(FX, "twinkle-photo.jpg"), "rb").read()
ok = S.decode_pages(json.dumps({"pages": ["data:image/jpeg;base64," + base64.b64encode(jpg).decode()]}))
check("accepts a JPEG data URL", len(ok) == 1 and ok[0][1] == ".jpg")
check("rejects bad JSON", err(b"{nope")[0] == 400)
check("rejects no pages", err(json.dumps({"pages": []}))[0] == 400)
check("rejects too many pages", err(json.dumps({"pages": ["x"] * (S.MAX_PAGES + 1)}))[0] == 400)
check("rejects non-images", err(json.dumps({"pages": [base64.b64encode(b"%PDF-1.4 hello").decode()]}))[0] == 415)
check("rejects broken base64", err(json.dumps({"pages": ["data:image/png;base64,@@@"]}))[0] == 400)

one = open(os.path.join(FX, "bach-bwv66.6-homr.musicxml"), encoding="utf-8").read()
merged = ET.fromstring(S.merge_pages([one, one]).split("\n", 1)[1])
measures = merged.find("part").findall("measure")
n1 = len(ET.fromstring(one.encode()).find("part").findall("measure"))
check("merging two pages doubles the bars", len(measures) == 2 * n1, "%d bars" % len(measures))
check("bars are renumbered in order", [m.get("number") for m in measures][-1] == str(2 * n1))
check("one page is returned unchanged", S.merge_pages([one]) == one)

print("\n%d failed" % failed if failed else "\nAll server tests passed")
sys.exit(1 if failed else 0)
