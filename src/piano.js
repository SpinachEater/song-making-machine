// A small piano synthesizer built with the Web Audio API (additive partials with
// slightly stretched overtones, a fast decay and a hammer thump). Shared by the modules.
(function (root) {
  'use strict';
  let master = null;
  function out(ac) {
    if (!master || master.context !== ac) {
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      master = ac.createGain(); master.gain.value = 0.8;
      master.connect(comp); comp.connect(ac.destination);
    }
    return master;
  }
  // Schedules one piano note; returns the audio nodes so the caller can stop them early.
  function note(ac, midi, when, len, vel) {
    vel = vel == null ? 1 : vel;
    const f0 = 440 * Math.pow(2, (midi - 69) / 12);
    const dest = out(ac);
    const voice = ac.createGain();
    voice.gain.value = vel;
    voice.connect(dest);
    const B = 0.00035; // string stiffness → slightly stretched partials
    const bright = Math.max(0.35, Math.min(1, 1.4 - (midi - 48) / 48));
    const sustainEnd = when + Math.max(len, 0.12);
    const release = 0.18;
    const nodes = [];
    for (let k = 1; k <= 10; k++) {
      const fk = f0 * k * Math.sqrt(1 + B * k * k);
      if (fk > 9000) break;
      const amp = (0.32 / Math.pow(k, 1.15)) * (k === 1 ? 1 : bright) * (k % 7 === 0 ? 0.3 : 1);
      const decay = (2.8 - midi / 50) / (1 + 0.45 * (k - 1));
      const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = fk;
      const gn = ac.createGain();
      gn.gain.setValueAtTime(0, when);
      gn.gain.linearRampToValueAtTime(amp, when + 0.004);
      gn.gain.setTargetAtTime(amp * 0.25, when + 0.004, Math.max(0.08, decay * 0.35));
      gn.gain.setTargetAtTime(0, sustainEnd, release / 3);
      o.connect(gn); gn.connect(voice);
      o.start(when); o.stop(sustainEnd + release * 2);
      nodes.push(o);
    }
    // hammer thump
    const nb = ac.createBuffer(1, Math.round(ac.sampleRate * 0.03), ac.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    const ns = ac.createBufferSource(); ns.buffer = nb;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = Math.min(4000, f0 * 3); bp.Q.value = 1.2;
    const ng = ac.createGain(); ng.gain.value = 0.08;
    ns.connect(bp); bp.connect(ng); ng.connect(voice); ns.start(when);
    nodes.push(ns);
    return nodes;
  }

  const api = { note };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Piano = api;
})(typeof window !== 'undefined' ? window : globalThis);
