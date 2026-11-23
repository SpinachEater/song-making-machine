// Hum-to-notes engine: pitch detection (YIN) and note segmentation.
// Works in the browser and in Node (for tests). No dependencies.
(function (root) {
  'use strict';

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  function midiToName(m) {
    return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  }
  function freqToMidi(f) {
    return 69 + 12 * Math.log2(f / 440);
  }
  function midiToFreq(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  // YIN pitch estimate for one frame. Returns {f, conf} (f = 0 when unvoiced).
  function yinFrame(buf, offset, win, minTau, maxTau, d, threshold) {
    for (let tau = 1; tau <= maxTau; tau++) {
      let s = 0;
      for (let i = 0; i < win; i++) {
        const x = buf[offset + i] - buf[offset + i + tau];
        s += x * x;
      }
      d[tau] = s;
    }
    // Cumulative mean normalized difference
    d[0] = 1;
    let run = 0;
    for (let tau = 1; tau <= maxTau; tau++) {
      run += d[tau];
      d[tau] = run > 0 ? (d[tau] * tau) / run : 1;
    }
    let tau = -1;
    for (let t = minTau; t <= maxTau; t++) {
      if (d[t] < threshold) {
        while (t + 1 <= maxTau && d[t + 1] < d[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) return { f: 0, conf: 0 };
    let better = tau;
    if (tau > 1 && tau < maxTau) {
      const a = d[tau - 1], b = d[tau], c = d[tau + 1];
      const den = a + c - 2 * b;
      if (den !== 0) better = tau + (a - c) / (2 * den);
    }
    // f is in cycles per sample; the caller multiplies by the sample rate
    return { f: 1 / better, conf: 1 - d[tau] };
  }

  function median(arr) {
    if (!arr.length) return NaN;
    const s = arr.slice().sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // Track pitch over a mono signal. Returns frames [{t, rms, midi|null, conf}].
  function trackPitch(samples, sr, opts) {
    opts = opts || {};
    const minF = opts.minF || 65;   // ~C2
    const maxF = opts.maxF || 1100; // ~C#6
    const hop = Math.round(sr * 0.01);
    const win = Math.round(sr * 0.03);
    const minTau = Math.max(2, Math.floor(sr / maxF));
    const maxTau = Math.ceil(sr / minF);
    const frameLen = win + maxTau + 1;
    const d = new Float32Array(maxTau + 2);
    const frames = [];
    for (let start = 0; start + frameLen <= samples.length; start += hop) {
      let e = 0;
      for (let i = 0; i < win; i++) e += samples[start + i] * samples[start + i];
      const rms = Math.sqrt(e / win);
      const r = rms > 1e-4 ? yinFrame(samples, start, win, minTau, maxTau, d, 0.2) : { f: 0, conf: 0 };
      const f = r.f * sr;
      frames.push({ t: (start + win / 2) / sr, rms, midi: f > 0 ? freqToMidi(f) : null, conf: r.conf });
    }
    return frames;
  }

  // Turn frames into notes.
  function framesToNotes(frames, opts) {
    opts = opts || {};
    const minDur = opts.minDur || 0.08;
    const autoTune = opts.autoTune !== false;
    const peak = frames.reduce((m, f) => Math.max(m, f.rms), 0);
    const gate = Math.max(peak * 0.12, 0.003);

    // Voiced mask
    const v = frames.map((f) => f.midi !== null && f.rms >= gate && f.conf > 0.6);

    // Median-smooth pitch over voiced neighbours (kills octave blips)
    const sm = frames.map((f, i) => {
      if (!v[i]) return null;
      const w = [];
      for (let k = i - 3; k <= i + 3; k++) if (k >= 0 && k < frames.length && v[k]) w.push(frames[k].midi);
      return median(w);
    });

    // Segment
    const segs = [];
    let cur = null;
    let gap = 0;
    let off = 0; // consecutive frames that disagree with current segment
    const close = () => {
      if (cur) segs.push(cur);
      cur = null;
      off = 0;
    };
    for (let i = 0; i < frames.length; i++) {
      if (!v[i]) {
        gap++;
        if (gap >= 3) close();
        continue;
      }
      gap = 0;
      const m = sm[i];
      if (!cur) {
        cur = { i0: i, i1: i, pitches: [m], peak: frames[i].rms };
        continue;
      }
      const ref = median(cur.pitches.slice(-15));
      // Re-attack on the same pitch: loudness dips well below the segment peak, then returns
      const dip = frames[i].rms < cur.peak * 0.35;
      if (dip && cur.pitches.length > 5) {
        // look ahead: does it come back up?
        let j = i + 1;
        while (j < frames.length && v[j] && frames[j].rms < cur.peak * 0.5) j++;
        if (j < frames.length && v[j] && frames[j].rms >= cur.peak * 0.5 && j - i < 15) {
          close();
          i = j - 1;
          continue;
        }
      }
      if (Math.abs(m - ref) > 0.6) {
        off++;
        if (off >= 4) {
          // Start new segment at the first disagreeing frame
          const startI = i - off + 1;
          cur.pitches.splice(cur.pitches.length - (off - 1), off - 1);
          cur.i1 = startI - 1;
          segs.push(cur);
          cur = { i0: startI, i1: i, pitches: sm.slice(startI, i + 1).filter((x) => x !== null), peak: frames[i].rms };
          off = 0;
          continue;
        }
      } else {
        off = 0;
      }
      cur.i1 = i;
      cur.pitches.push(m);
      cur.peak = Math.max(cur.peak, frames[i].rms);
    }
    close();

    const hopT = frames.length > 1 ? frames[1].t - frames[0].t : 0.01;
    let notes = segs
      .map((s) => {
        // Ignore the first/last 15% (scoops and tails) when estimating the pitch
        const n = s.pitches.length;
        const a = Math.floor(n * 0.15), b = Math.max(a + 1, Math.ceil(n * 0.85));
        return {
          start: frames[s.i0].t - hopT / 2,
          dur: (s.i1 - s.i0 + 1) * hopT,
          pitch: median(s.pitches.slice(a, b)),
        };
      })
      .filter((n) => n.dur >= minDur && isFinite(n.pitch));

    // Overall tuning offset (singer slightly sharp/flat as a whole)
    let tuning = 0;
    if (autoTune && notes.length) {
      // Circular mean of the fractional part, weighted by duration
      let sx = 0, sy = 0;
      for (const n of notes) {
        const ang = 2 * Math.PI * (n.pitch - Math.round(n.pitch));
        sx += Math.cos(ang) * n.dur;
        sy += Math.sin(ang) * n.dur;
      }
      tuning = Math.atan2(sy, sx) / (2 * Math.PI);
    }

    notes = notes.map((n) => {
      const midi = Math.round(n.pitch - tuning);
      return {
        start: n.start,
        dur: n.dur,
        midi,
        name: midiToName(midi),
        cents: Math.round((n.pitch - tuning - midi) * 100),
      };
    });

    // Merge neighbours split by jitter (same note, touching)
    const merged = [];
    for (const n of notes) {
      const p = merged[merged.length - 1];
      if (p && p.midi === n.midi && n.start - (p.start + p.dur) < 0.015) {
        p.dur = n.start + n.dur - p.start;
      } else merged.push({ ...n });
    }
    return { notes: merged, tuningCents: Math.round(tuning * 100) };
  }

  function analyze(samples, sr, opts) {
    const frames = trackPitch(samples, sr, opts);
    const res = framesToNotes(frames, opts);
    return { frames, notes: res.notes, tuningCents: res.tuningCents };
  }

  const api = { analyze, trackPitch, framesToNotes, midiToName, midiToFreq, freqToMidi };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HumEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
