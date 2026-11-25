"""Sends a photo to a running reader and checks the notes that come back.

    python3 server/smoke_test.py http://localhost:7860 test/fixtures/twinkle-photo.jpg
"""
import base64
import json
import sys
import time
import urllib.request

url, photo = sys.argv[1].rstrip("/"), sys.argv[2]
for _ in range(60):  # wait up to a minute for the server to start
    try:
        with urllib.request.urlopen(url + "/health", timeout=5) as r:
            print("health:", r.read().decode())
            break
    except OSError:
        time.sleep(1)
else:
    sys.exit("server did not start")

body = json.dumps({"pages": ["data:image/jpeg;base64," + base64.b64encode(open(photo, "rb").read()).decode()]})
req = urllib.request.Request(url + "/recognize", data=body.encode(), headers={"Content-Type": "application/json"})
with urllib.request.urlopen(req, timeout=600) as r:
    res = json.load(r)
xml = res["musicxml"]
steps = [s.split("</step>")[0] for s in xml.split("<step>")[1:]]
print("read in %ss: %s" % (res.get("seconds"), " ".join(steps)))
expected = "C C G G A A G F F E E D D C".split()
if steps != expected:
    sys.exit("expected %s" % " ".join(expected))
print("PASS  Twinkle photo read correctly")
