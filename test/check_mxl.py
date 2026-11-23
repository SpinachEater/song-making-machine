"""Opens each .mxl written by musicxml.test.js with music21 and checks its contents.

Run: python3 test/check_mxl.py tmp-mxl   (needs: pip install music21)
"""
import json
import pathlib
import sys
import zipfile

import music21

out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "tmp-mxl")
expected = json.loads((out / "expected.json").read_text())
failed = 0
for name, exp in expected.items():
    path = out / f"{name}.mxl"
    with zipfile.ZipFile(path) as z:
        assert z.testzip() is None, "corrupt zip"
        assert z.namelist()[0] == "mimetype"
    score = music21.converter.parse(str(path))
    part = score.parts[0]
    notes = [n for n in part.stripTies().recurse().notes]
    midis = [n.pitch.midi for n in notes]
    key = part.recurse().getElementsByClass("KeySignature")[0].sharps
    ts = part.recurse().getElementsByClass("TimeSignature")[0].ratioString
    measures = len(part.getElementsByClass("Measure"))
    bar_ok = all(
        abs(m.duration.quarterLength - part.recurse().getElementsByClass("TimeSignature")[0].barDuration.quarterLength) < 1e-6
        for m in part.getElementsByClass("Measure")
    )
    ok = midis == exp["midis"] and key == exp["key"] and ts == exp["timeSig"] and measures == exp["measures"] and bar_ok
    failed += not ok
    print(f"{'PASS' if ok else 'FAIL'} {name}: {len(midis)} notes, key {key:+d}, {ts}, {measures} bars, bars full: {bar_ok}")
    if not ok:
        print("  want", exp, "\n  got ", midis, key, ts, measures)
print("All passed" if not failed else f"{failed} failed")
sys.exit(1 if failed else 0)
