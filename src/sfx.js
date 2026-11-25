// Synthesized sound effects (no audio files needed).
export class Sfx {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(ctx.destination);
      const len = ctx.sampleRate * 2;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      // Wing buzz: two detuned oscillators + airy noise, pulsed by a fast tremolo (wing beats)
      this.wingGain = ctx.createGain();
      this.wingGain.gain.value = 0;
      const trem = ctx.createGain();
      trem.gain.value = 0.6;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 32;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = 0.4;
      lfo.connect(lfoDepth).connect(trem.gain);
      lfo.start();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1100;
      bp.Q.value = 0.7;
      this.wingOscs = [];
      for (const [type, f] of [['sawtooth', 185], ['square', 232]]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f;
        o.connect(bp);
        o.start();
        this.wingOscs.push({ o, f });
      }
      const air = ctx.createBufferSource();
      air.buffer = this.noiseBuf;
      air.loop = true;
      const airF = ctx.createBiquadFilter();
      airF.type = 'highpass';
      airF.frequency.value = 2500;
      const airG = ctx.createGain();
      airG.gain.value = 0.35;
      air.connect(airF).connect(airG).connect(bp);
      air.start();
      bp.connect(trem).connect(this.wingGain).connect(this.master);

      // Toy car motor
      this.carOsc = ctx.createOscillator();
      this.carOsc.type = 'square';
      this.carOsc.frequency.value = 70;
      const cf = ctx.createBiquadFilter();
      cf.type = 'lowpass';
      cf.frequency.value = 700;
      this.carGain = ctx.createGain();
      this.carGain.gain.value = 0;
      this.carOsc.connect(cf).connect(this.carGain).connect(this.master);
      this.carOsc.start();
    } catch {
      this.ctx = null;
    }
  }

  tone(freq, dur, { type = 'sine', gain = 0.3, freqEnd = null, delay = 0 } = {}) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise(dur, { type = 'bandpass', freq = 1000, freqEnd = null, q = 1, gain = 0.3, attack = 0.005, delay = 0 } = {}) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  // Tiny leg "skitter" (two quick clicks): called once per step while crawling — floor, walls, leaves, anywhere
  tick(v, surface = 'floor') {
    const base = surface === 'wall' ? 2600 : surface === 'leaf' ? 1800 : 3500;
    const g = 0.05 + 0.12 * v;
    this.noise(0.018, { type: 'highpass', freq: base + Math.random() * 3000, gain: g, attack: 0.002 });
    this.noise(0.014, { type: 'bandpass', freq: base * 1.4 + Math.random() * 2000, q: 4, gain: g * 0.7, attack: 0.002, delay: 0.025 + Math.random() * 0.02 });
  }

  // A high-pitched girl's scream ("KYAAAH!" / short "EEEK!"): two slightly detuned bright voices with a fast,
  // nervous vibrato, pushed through "ee/aa" vowel formants, plus breathy noise. No speech synthesis.
  shout(kind = 'aah') {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    const eek = kind === 'eek';
    const dur = eek ? 0.7 : 1.4;
    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.55, t + 0.05);
    out.gain.setValueAtTime(0.5, t + dur * 0.6);
    out.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const comp = c.createDynamicsCompressor();
    out.connect(comp).connect(this.master);
    const formants = [[1000, 4], [1650, 6], [3000, 8], [4200, 10]];
    const bands = formants.map(([f, q]) => {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      bp.connect(out);
      return bp;
    });
    for (const detune of [0, 14]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      const f0 = (eek ? 1150 : 900) + detune;
      o.frequency.setValueAtTime(f0 * 0.8, t);
      o.frequency.exponentialRampToValueAtTime(f0 * 1.25, t + 0.12); // shriek up
      o.frequency.exponentialRampToValueAtTime(f0 * 1.1, t + dur * 0.5);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.75, t + dur); // trail off
      const vib = c.createOscillator();
      vib.frequency.value = 9 + Math.random() * 3;
      const vibG = c.createGain();
      vibG.gain.value = f0 * 0.045;
      vib.connect(vibG).connect(o.frequency);
      for (const b of bands) o.connect(b);
      o.start(t); vib.start(t);
      o.stop(t + dur + 0.05); vib.stop(t + dur + 0.05);
    }
    // breath / rasp
    this.noise(dur * 0.9, { type: 'bandpass', freq: 3200, q: 1.2, gain: 0.12, attack: 0.04 });
  }

  // Sims-style chipmunk gibberish: a quick string of random "syllables", each a pitched blip shaped by
  // vowel formants (a/e/i/o/u), sped up and pitched high like a chipmunk.
  babble(voice = 'mak', dur = 1.5) {
    const c = this.ctx;
    if (!c) return;
    if (this._babbleOut) { try { this._babbleOut.gain.setTargetAtTime(0, c.currentTime, 0.02); } catch { /* ignore */ } }
    const out = c.createGain();
    out.gain.value = 1;
    out.connect(this.master);
    this._babbleOut = out;
    const base = { kids: 1150, mak: 780, ayah: 520 }[voice] || 700;
    const vowels = [[800, 1200], [450, 2100], [320, 2700], [520, 900], [380, 800]];
    let t = c.currentTime + 0.03;
    const end = t + dur;
    let pitch = base;
    while (t < end) {
      const len = 0.05 + Math.random() * 0.07;
      pitch = Math.max(base * 0.75, Math.min(base * 1.4, pitch * (0.88 + Math.random() * 0.26))); // wandering intonation
      const o = c.createOscillator();
      o.type = Math.random() < 0.5 ? 'triangle' : 'sawtooth';
      o.frequency.setValueAtTime(pitch, t);
      o.frequency.exponentialRampToValueAtTime(pitch * (0.85 + Math.random() * 0.4), t + len);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(voice === 'kids' ? 0.16 : 0.2, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      const [f1, f2] = vowels[Math.floor(Math.random() * vowels.length)];
      const k = base / 600; // chipmunk: formants shifted up with the pitch
      for (const [f, q] of [[f1 * k, 5], [f2 * k, 7]]) {
        const bp = c.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = f;
        bp.Q.value = q;
        o.connect(bp).connect(g);
      }
      g.connect(out);
      o.start(t);
      o.stop(t + len + 0.02);
      t += len + (Math.random() < 0.18 ? 0.08 + Math.random() * 0.06 : 0.012); // little pauses between "words"
    }
  }

  // Chipmunk crying: wobbling, falling wails with sniffly breaths between them
  sob(voice = 'kids', dur = 2) {
    const c = this.ctx;
    if (!c) return;
    const base = { kids: 1250, mak: 820, ayah: 560 }[voice] || 800;
    let t = c.currentTime + 0.02;
    const end = t + dur;
    while (t < end) {
      const len = 0.35 + Math.random() * 0.35;
      const o = c.createOscillator();
      o.type = 'triangle';
      const p = base * (1.05 + Math.random() * 0.2);
      o.frequency.setValueAtTime(p, t);
      o.frequency.linearRampToValueAtTime(p * 0.62, t + len); // "waaah" falling
      const vib = c.createOscillator();
      vib.frequency.value = 9;
      const vg = c.createGain();
      vg.gain.value = p * 0.04;
      vib.connect(vg).connect(o.frequency);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(voice === 'kids' ? 0.1 : 0.13, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = base * 1.4;
      bp.Q.value = 1.5;
      o.connect(bp).connect(g).connect(this.master);
      o.start(t); vib.start(t);
      o.stop(t + len + 0.02); vib.stop(t + len + 0.02);
      t += len + 0.06;
      // sniff
      this.noise(0.08, { type: 'highpass', freq: 3000, gain: 0.05, delay: t - c.currentTime });
      t += 0.12 + Math.random() * 0.1;
    }
  }

  // Low, rumbly snore (the human asleep in front of the TV)
  snore() {
    if (!this.ctx) return;
    this.noise(1.1, { type: 'lowpass', freq: 260, freqEnd: 140, gain: 0.07, attack: 0.4 });
    this.tone(70, 1.0, { type: 'sawtooth', gain: 0.025, freqEnd: 55, delay: 0.1 });
  }

  count(n) { this.tone(n > 0 ? 660 : 990, n > 0 ? 0.18 : 0.45, { type: 'square', gain: 0.12 }); if (n === 0) this.tone(1320, 0.4, { type: 'triangle', gain: 0.1, delay: 0.05 }); }
  // little high-pitched happy chirps (the roach kids)
  chirp(n = 3) { for (let i = 0; i < n; i++) this.tone(1400 + Math.random() * 900, 0.08, { type: 'triangle', freqEnd: 2200 + Math.random() * 600, gain: 0.08, delay: i * 0.11 }); }
  land(v) { this.noise(0.09, { type: 'lowpass', freq: 400, gain: 0.1 + 0.25 * v, attack: 0.003 }); }
  crunch() {
    this.noise(0.05, { type: 'bandpass', freq: 1400 + Math.random() * 1200, q: 2, gain: 0.25 });
    this.noise(0.04, { type: 'bandpass', freq: 2200 + Math.random() * 1200, q: 2, gain: 0.18, delay: 0.06 });
  }
  thud() {
    this.tone(110, 0.4, { freqEnd: 35, gain: 0.9 });
    this.noise(0.2, { type: 'lowpass', freq: 500, gain: 0.6 });
  }
  hiss(d) { this.noise(d, { type: 'highpass', freq: 3000, gain: 0.25, attack: 0.05 }); }
  swish() { this.noise(0.5, { type: 'bandpass', freq: 500, freqEnd: 2500, q: 0.8, gain: 0.4, attack: 0.08 }); }
  pickup() {
    this.tone(660, 0.07, { type: 'square', gain: 0.05 });
    this.tone(990, 0.1, { type: 'square', gain: 0.05, delay: 0.06 });
  }
  foodDone() {
    [523, 659, 784].forEach((f, i) => this.tone(f, 0.18, { type: 'triangle', gain: 0.12, delay: i * 0.08 }));
  }
  hurt() { this.tone(320, 0.25, { type: 'sawtooth', freqEnd: 110, gain: 0.18 }); }
  warn() { this.tone(880, 0.12, { type: 'triangle', gain: 0.12 }); }
  suspicious() { this.tone(420, 0.35, { type: 'triangle', freqEnd: 760, gain: 0.12 }); }
  alert() {
    this.tone(620, 0.14, { type: 'square', gain: 0.1 });
    this.tone(930, 0.3, { type: 'square', gain: 0.1, delay: 0.14 });
  }
  lost() { this.tone(700, 0.45, { type: 'triangle', freqEnd: 380, gain: 0.12 }); }
  scream(kind = 'aah') { this.shout(kind); }
  meow() {
    this.tone(520, 0.22, { type: 'triangle', freqEnd: 820, gain: 0.16 });
    this.tone(820, 0.4, { type: 'triangle', freqEnd: 430, gain: 0.16, delay: 0.2 });
  }
  beep() {
    this.tone(1250, 0.07, { type: 'square', gain: 0.07 });
    this.tone(1250, 0.07, { type: 'square', gain: 0.07, delay: 0.12 });
  }
  // Something falls over: thump + clatter (big = cupboard/TV, with glass)
  crash(big) {
    this.tone(big ? 70 : 140, big ? 0.6 : 0.3, { freqEnd: 35, gain: big ? 0.9 : 0.5 });
    this.noise(big ? 0.6 : 0.3, { type: 'lowpass', freq: big ? 900 : 1600, gain: big ? 0.7 : 0.45 });
    for (let i = 0; i < (big ? 6 : 3); i++) this.noise(0.06, { type: 'bandpass', freq: 2500 + Math.random() * 3000, q: 3, gain: 0.2, delay: 0.05 + i * 0.07 });
    if (big) this.noise(0.5, { type: 'highpass', freq: 5000, gain: 0.25, delay: 0.05 }); // glass
  }
  death() { this.tone(400, 0.9, { type: 'triangle', freqEnd: 60, gain: 0.25 }); }
  win() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', gain: 0.15, delay: i * 0.12 })); }

  setWings(level, pitch = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.wingGain.gain.setTargetAtTime(level * 0.09, t, 0.04);
    for (const w of this.wingOscs) w.o.frequency.setTargetAtTime(w.f * pitch, t, 0.05);
  }
  setCar(level, speed) {
    if (!this.ctx) return;
    this.carGain.gain.setTargetAtTime(level * level * 0.06, this.ctx.currentTime, 0.1);
    this.carOsc.frequency.setTargetAtTime(50 + speed * 7, this.ctx.currentTime, 0.1);
  }
  silence() {
    this.setWings(0);
    this.setCar(0, 0);
  }
}
