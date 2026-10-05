// Synthesized sound: effects with a noise burst and a low thump, an alarm that follows the ball, and a small step sequencer for
// driving electronic music (128 BPM, A minor). No files. The platform applies volume and mute to everything connected to the
// destination, so there are no controls here. Nothing in this file may throw into the game.

const BPM = 128;
const S16 = 60 / BPM / 4;
// i - VI - III - VII in A minor: root (bass) and the chord (pad, arp)
const PROG = [
  { root: 55.0, chord: [220.0, 261.63, 329.63] }, // Am
  { root: 43.65, chord: [174.61, 220.0, 261.63] }, // F
  { root: 65.41, chord: [261.63, 329.63, 392.0] }, // C
  { root: 49.0, chord: [196.0, 246.94, 293.66] }, // G
];
const ARP = [0, 2, 1, 2, 0, 1, 2, 1, 0, 2, 1, 2, 2, 1, 0, 1];
const BASS = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0];

export function createAudio() {
  let ctx = null;
  let master = null;
  let sfxBus = null;
  let musicBus = null;
  let noise = null;
  let timer = null;
  let nextTime = 0;
  let stepNo = 0;
  let intensity = 0;
  let musicOn = false;
  let hum = null;
  let lastAlarm = 0;
  let quality = 'high';

  const safe =
    (fn) =>
    (...args) => {
      if (!ctx) return;
      try {
        return fn(...args);
      } catch {
        /* sound is never worth a crash */
      }
    };

  function start() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 4;
        comp.attack.value = 0.004;
        comp.release.value = 0.18;
        master = ctx.createGain();
        master.gain.value = 0.9;
        master.connect(comp);
        comp.connect(ctx.destination);
        sfxBus = ctx.createGain();
        sfxBus.gain.value = 1;
        sfxBus.connect(master);
        musicBus = ctx.createGain();
        musicBus.gain.value = 0.0;
        musicBus.connect(master);
        noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.5), ctx.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    } catch {
      ctx = null;
      return false;
    }
  }

  // ---------------------------------------------------------------- building blocks
  function osc(type, f0, f1, t, dur, gain, bus = sfxBus, attack = 0.003, curve = 'exp') {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, f0), t);
    if (f1 && f1 !== f0) {
      if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      else o.frequency.linearRampToValueAtTime(f1, t + dur);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(bus);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  function burst(t, dur, gain, { type = 'highpass', f0 = 1500, f1 = 0, q = 0.8, bus = sfxBus } = {}) {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(bus);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  const now = () => ctx.currentTime + 0.005;

  // ---------------------------------------------------------------- effects
  const sfx = {
    tick: safe(() => osc('sine', 1200, 900, now(), 0.04, 0.12)),
    swing: safe(() => {
      const t = now();
      burst(t, 0.2, 0.28, { type: 'bandpass', f0: 500, f1: 2600, q: 1.2 });
    }),
    deflect: safe((power = 0.5, perfect = false) => {
      const t = now();
      const p = Math.max(0, Math.min(1, power));
      osc('sine', 170, 42, t, 0.28, 0.95);
      burst(t, 0.14, 0.55, { type: 'highpass', f0: 1800 });
      osc('triangle', 760 * (1 + p * 0.9), 700 * (1 + p * 0.9), t, 0.5, 0.24);
      osc('square', 1140 * (1 + p * 0.9), 1100 * (1 + p * 0.9), t, 0.35, 0.07);
      if (perfect) {
        osc('sine', 1760, 2640, t + 0.02, 0.35, 0.22);
        osc('sine', 2637, 3520, t + 0.05, 0.3, 0.12);
      }
      duck(0.55, 0.14);
    }),
    hit: safe((big = true) => {
      const t = now();
      osc('sine', 120, 28, t, big ? 0.75 : 0.4, big ? 1.0 : 0.6);
      burst(t, big ? 0.55 : 0.3, big ? 0.85 : 0.5, { type: 'lowpass', f0: 2200, f1: 300 });
      if (big) {
        for (let i = 0; i < 7; i++) burst(t + 0.04 + Math.random() * 0.4, 0.05, 0.22, { type: 'highpass', f0: 3000 + Math.random() * 3000 });
      }
      duck(0.35, 0.4);
    }),
    thud: safe(() => {
      const t = now();
      osc('sine', 90, 40, t, 0.2, 0.7);
      burst(t, 0.1, 0.3, { type: 'lowpass', f0: 900 });
    }),
    charge: safe(() => {
      const t = now();
      const o = ctx.createOscillator();
      const f = ctx.createBiquadFilter();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(70, t);
      o.frequency.exponentialRampToValueAtTime(420, t + 1.0);
      f.type = 'lowpass';
      f.frequency.setValueAtTime(200, t);
      f.frequency.exponentialRampToValueAtTime(5000, t + 1.0);
      f.Q.value = 6;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.4, t + 0.95);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.05);
      o.connect(f);
      f.connect(g);
      g.connect(sfxBus);
      o.start(t);
      o.stop(t + 1.1);
      burst(t, 1.0, 0.18, { type: 'bandpass', f0: 300, f1: 4000, q: 2 });
    }),
    launch: safe(() => {
      const t = now();
      osc('sine', 260, 50, t, 0.5, 0.9);
      burst(t, 0.3, 0.6, { type: 'highpass', f0: 900 });
      osc('sawtooth', 220, 880, t, 0.25, 0.14);
    }),
    count: safe((n = 3) => osc('square', n === 1 ? 880 : 660, n === 1 ? 880 : 660, now(), 0.12, 0.12)),
    go: safe(() => {
      const t = now();
      osc('square', 990, 990, t, 0.35, 0.12);
      osc('square', 1320, 1320, t, 0.35, 0.09);
      osc('sawtooth', 110, 55, t, 0.4, 0.3);
      burst(t, 0.2, 0.35, { type: 'highpass', f0: 2000 });
    }),
    clash: safe((n = 3) => {
      const t = now();
      const f = 520 * 2 ** (Math.min(20, n) / 12);
      osc('triangle', f, f, t, 0.16, 0.2);
      osc('sine', f * 2, f * 2, t, 0.1, 0.08);
    }),
    alarm: safe((freq = 600) => osc('square', freq, freq, now(), 0.07, 0.1)),
    jump: safe(() => osc('sine', 240, 520, now(), 0.11, 0.14)),
    land: safe(() => burst(now(), 0.07, 0.2, { type: 'lowpass', f0: 500 })),
    dash: safe(() => {
      const t = now();
      burst(t, 0.18, 0.3, { type: 'bandpass', f0: 400, f1: 3200, q: 1 });
      osc('sawtooth', 200, 90, t, 0.15, 0.08);
    }),
    refuse: safe(() => osc('square', 180, 150, now(), 0.06, 0.06)),
    win: safe(() => {
      const t = now();
      [0, 3, 7, 12, 15, 19].forEach((semi, i) => {
        const f = 220 * 2 ** (semi / 12);
        osc('sawtooth', f, f, t + i * 0.085, 0.5, 0.11);
        osc('square', f * 2, f * 2, t + i * 0.085, 0.3, 0.04);
      });
      burst(t, 0.3, 0.3, { type: 'highpass', f0: 2500 });
    }),
    lose: safe(() => {
      const t = now();
      [0, -3, -7, -12].forEach((semi, i) => osc('triangle', 330 * 2 ** (semi / 12), 320 * 2 ** (semi / 12), t + i * 0.12, 0.4, 0.14));
    }),
    spawn: safe(() => osc('sine', 300, 700, now(), 0.15, 0.08)),
    nice: safe((streak = 1) => {
      const f = 660 * 2 ** (Math.min(8, streak) / 12);
      osc('triangle', f, f * 1.5, now(), 0.15, 0.13);
    }),
  };

  /** Music gets quieter for a moment under a big sound. */
  function duck(depth, secs) {
    if (!ctx || !musicBus || !musicOn) return;
    const t = ctx.currentTime;
    const target = musicTarget();
    musicBus.gain.cancelScheduledValues(t);
    musicBus.gain.setValueAtTime(musicBus.gain.value, t);
    musicBus.gain.linearRampToValueAtTime(target * depth, t + 0.01);
    musicBus.gain.linearRampToValueAtTime(target, t + secs + 0.25);
  }
  const musicTarget = () => [0.42, 0.5, 0.78, 0.9][intensity] ?? 0.5;

  /** The ball's own hum: it rises with its speed. */
  function setHum(active, speed = 0) {
    if (!ctx) return;
    try {
      if (active && !hum) {
        const o = ctx.createOscillator();
        const o2 = ctx.createOscillator();
        const f = ctx.createBiquadFilter();
        const g = ctx.createGain();
        o.type = 'sawtooth';
        o2.type = 'sine';
        f.type = 'lowpass';
        f.frequency.value = 500;
        g.gain.value = 0;
        o.connect(f);
        o2.connect(f);
        f.connect(g);
        g.connect(sfxBus);
        o.start();
        o2.start();
        hum = { o, o2, g, f };
      }
      if (hum) {
        const t = ctx.currentTime;
        const f0 = 60 + Math.min(220, speed) * 0.9;
        hum.o.frequency.setTargetAtTime(f0, t, 0.05);
        hum.o2.frequency.setTargetAtTime(f0 * 2.01, t, 0.05);
        hum.f.frequency.setTargetAtTime(300 + speed * 6, t, 0.05);
        hum.g.gain.setTargetAtTime(active ? 0.04 + Math.min(1, speed / 200) * 0.05 : 0, t, 0.08);
        if (!active) {
          const h = hum;
          hum = null;
          setTimeout(() => {
            try {
              h.o.stop();
              h.o2.stop();
            } catch {
              /* already stopped */
            }
          }, 400);
        }
      }
    } catch {
      /* ignore */
    }
  }

  /** The alarm while the ball is coming for you: faster as it nears, higher as it nears. dist in units, tti in seconds. */
  function alarm(dist, tti, tNow) {
    if (!ctx) return;
    const interval = Math.max(0.09, Math.min(0.7, tti * 0.55));
    if (tNow - lastAlarm < interval) return;
    lastAlarm = tNow;
    sfx.alarm(380 + (1 - Math.min(1, dist / 45)) * 1100);
  }

  // ---------------------------------------------------------------- music
  function kick(t, strong) {
    osc('sine', 150, 42, t, 0.22, strong ? 0.9 : 0.55, musicBus, 0.002);
    if (strong) burst(t, 0.03, 0.18, { type: 'highpass', f0: 3000, bus: musicBus });
  }
  function clap(t) {
    burst(t, 0.13, 0.32, { type: 'bandpass', f0: 1800, q: 0.9, bus: musicBus });
    burst(t + 0.012, 0.09, 0.22, { type: 'bandpass', f0: 2600, q: 0.9, bus: musicBus });
  }
  function hat(t, open) {
    burst(t, open ? 0.12 : 0.035, open ? 0.14 : 0.1, { type: 'highpass', f0: 7000, bus: musicBus });
  }
  function bassNote(t, f, len) {
    const o = ctx.createOscillator();
    const fl = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = f;
    fl.type = 'lowpass';
    fl.frequency.setValueAtTime(900, t);
    fl.frequency.exponentialRampToValueAtTime(160, t + len);
    fl.Q.value = 5;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(fl);
    fl.connect(g);
    g.connect(musicBus);
    o.start(t);
    o.stop(t + len + 0.05);
  }
  function leadNote(t, f, len, gain) {
    const o = ctx.createOscillator();
    const fl = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = f;
    fl.type = 'lowpass';
    fl.frequency.value = 2400;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(fl);
    fl.connect(g);
    g.connect(musicBus);
    o.start(t);
    o.stop(t + len + 0.05);
  }
  function pad(t, chord, len) {
    for (const f of chord) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        const fl = ctx.createBiquadFilter();
        const g = ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = det;
        fl.type = 'lowpass';
        fl.frequency.value = 900;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.028, t + 0.4);
        g.gain.linearRampToValueAtTime(0.02, t + len * 0.8);
        g.gain.linearRampToValueAtTime(0.0001, t + len);
        o.connect(fl);
        fl.connect(g);
        g.connect(musicBus);
        o.start(t);
        o.stop(t + len + 0.05);
      }
    }
  }

  function scheduleStep(t, n) {
    const bar = Math.floor(n / 16) % PROG.length;
    const s = n % 16;
    const { root, chord } = PROG[bar];
    const lv = intensity;
    if (s === 0) pad(t, chord, S16 * 16);
    // the arp is always there, softer in menus
    if (s % 2 === 0 || lv >= 2) {
      const note = chord[ARP[s]] * (lv >= 3 && s % 4 === 3 ? 4 : 2);
      leadNote(t, note, S16 * 1.6, lv >= 2 ? 0.05 : 0.026);
    }
    if (lv >= 1) {
      if (s % 4 === 0) kick(t, lv >= 2);
      if (BASS[s] || (lv >= 3 && s % 2 === 1)) bassNote(t, root * (s === 13 ? 2 : 1), S16 * 1.7);
    }
    if (lv >= 2) {
      if (s === 4 || s === 12) clap(t);
      if (s % 2 === 1 || (lv >= 3 && quality !== 'low')) hat(t, s % 4 === 3);
    }
  }

  function pump() {
    if (!ctx || !musicOn) return;
    try {
      const horizon = ctx.currentTime + 0.14;
      if (nextTime < ctx.currentTime - 0.3) nextTime = ctx.currentTime + 0.05;
      while (nextTime < horizon) {
        scheduleStep(nextTime, stepNo);
        stepNo++;
        nextTime += S16;
      }
    } catch {
      /* ignore */
    }
  }

  /** 0 title, 1 lobby, 2 playing, 3 playing and tense. */
  function setMusic(level, q = quality) {
    quality = q;
    if (!ctx) return;
    const next = Math.max(0, Math.min(3, level | 0));
    if (musicOn && next === intensity) return;
    if (!musicOn) {
      musicOn = true;
      nextTime = ctx.currentTime + 0.1;
      stepNo = 0;
      timer = setInterval(pump, 30);
    }
    intensity = next;
    try {
      musicBus.gain.cancelScheduledValues(ctx.currentTime);
      musicBus.gain.setTargetAtTime(musicTarget(), ctx.currentTime, 0.25);
    } catch {
      /* ignore */
    }
  }

  function stopMusic() {
    musicOn = false;
    if (timer) clearInterval(timer);
    timer = null;
    if (ctx && musicBus) {
      try {
        musicBus.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
      } catch {
        /* ignore */
      }
    }
  }

  return {
    start,
    get ready() {
      return !!ctx;
    },
    sfx,
    setMusic,
    stopMusic,
    setHum,
    alarm,
    duck,
  };
}
