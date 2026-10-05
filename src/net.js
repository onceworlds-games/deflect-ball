// The game's brain on top of the room: who plays, who runs the rules (the host), what everyone else is told, and what each page
// decides for itself. No three.js and no DOM, so a test can run several pages against a fake room.
//
//  - `g` (room state, host-written, keyed by match id): the match: round, phase, deadlines, roster, scores, who is out.
//  - `b` (room state, host-written, ~16 Hz): the ball and the bots, with match time. Other pages run the ball forward from it.
//  - presence: your own body, ~20 Hz. Others are drawn with presenceAt.
//  - a message `{ t: 'deflect', rid, n, to, aim }` to the host: the target's own page decides its deflect.
import {
  STEP, CHEST, HIT_R, INTRO_S, OVER_MS, FINAL_MS, PRESENCE_MS, SNAP_HZ_MAX, SNAP_HZ_MIN, CLASH_MIN, PERFECT_S, ROUND_DEFAULT, MAX_PLAYERS,
  clamp, num,
} from './config.js';
import {
  makeBody, stepBody, makeBall, makeDeflector, pressDeflect, windowOpen, deflectWorked, cooldownFrac, stepBall, sweptHit, redirectBall, pickTarget,
  lerpAngle,
} from './sim.js';
import { Round } from './round.js';
import { buildRoster, colorOf, spawnSlots, lobbySpot, roundGain, addScores, rankMatch, awardsFrom, round2 } from './match.js';
import { makePractice, resetPractice, stepPractice } from './practice.js';
import { hashString, mulberry32 } from './rng.js';

const r1 = (v) => Math.round(v * 10) / 10;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isVec = (a) => Array.isArray(a) && a.length === 3 && a.every(isNum);
/** A small number that says which round a presence belongs to (the host ignores presence from before the round began). */
export const qOf = (rid) => (hashString(String(rid)) % 65521) + 1;
const clone = (v) => JSON.parse(JSON.stringify(v));

export function createNet(
  room,
  { clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()), setTimer = setInterval, clearTimer = clearInterval } = {},
) {
  const me = room.me.id;
  const listeners = new Map();
  const on = (type, fn) => {
    let set = listeners.get(type);
    if (!set) listeners.set(type, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  };
  const emit = (type, data) => {
    for (const fn of listeners.get(type) ?? []) {
      try {
        fn(data);
      } catch (err) {
        console.error(`[deflect-ball] ${type} listener`, err);
      }
    }
  };

  // ---------------------------------------------------------------- what this page keeps
  /** My own character and its deflect button. */
  const L = { active: false, body: null, def: makeDeflector(), clock: 0, pressQ: false, aim: 0, lastSent: 0, lastKey: '', flags: { dashed: false, jumped: false, landed: false } };
  /** What this page remembers about the match it's in. */
  const S = {
    rid: null, rosterKey: null, roster: [], idx: new Map(), botOrder: [], slots: [], seenOut: 0, fired: new Set(), lastN: 0, lastClash: 0,
    lastPhase: 'lobby', first: room.match.phase === 'playing', restoreOnce: room.match.phase === 'playing', last: null, hitAt: -1,
  };
  /** The host's world. */
  const H = { g: null, round: null, brains: new Map(), lastNow: 0, acc: 0, snapAt: -1e9, dirty: false, gAt: -1e9, endedFor: null, endAt: 0 };
  /** The ball as a page that isn't the host sees it, and the bots' recent snapshots. */
  const V = { ball: makeBall(), have: false, ex: 0, ey: 0, ez: 0, localN: -1, localAt: -1, bots: [], botNow: new Map(), clash: 0 };
  const practice = makePractice(mulberry32((hashString(me) ^ 0x9e3779b9) >>> 0), me);

  // ---------------------------------------------------------------- reading the room
  const G = () => {
    const g = room.state.g;
    return g && typeof g === 'object' && g.mid === room.match.id ? g : null;
  };
  const gOut = (g) => (g && Array.isArray(g.out) ? g.out : []);

  function phase() {
    const m = room.match;
    if (m.phase === 'lobby') return 'lobby';
    if (m.phase === 'starting') return 'starting';
    const g = G();
    return g && typeof g.phase === 'string' ? g.phase : 'wait';
  }

  function rosterNow() {
    const m = room.match;
    if (m.phase === 'lobby') return S.roster;
    const g = G();
    const key = g && Array.isArray(g.roster) ? `${g.mid}:g` : `${m.id}:m`;
    if (S.rosterKey !== key) {
      const list =
        g && Array.isArray(g.roster)
          ? g.roster.filter((r) => r && typeof r.id === 'string').slice(0, MAX_PLAYERS + 8).map((r) => ({ id: r.id, bot: !!r.b, name: typeof r.nm === 'string' ? r.nm : undefined }))
          : buildRoster(m.participants, m.seed);
      S.roster = list.map((r, i) => ({ ...r, idx: i, color: colorOf(i) }));
      S.idx = new Map(S.roster.map((r) => [r.id, r]));
      S.botOrder = S.roster.filter((r) => r.bot);
      S.rosterKey = key;
      S.slots = S.rid ? spawnSlots(S.roster.length, S.rid) : [];
    }
    return S.roster;
  }

  const inRoster = () => {
    rosterNow();
    return S.idx.has(me);
  };
  const roundLive = (ph = phase()) => ph === 'intro' || ph === 'play';
  const meAlive = () => {
    const g = G();
    return !!g && inRoster() && !gOut(g).includes(me);
  };

  /** The runner of the rules: the host, connected, with a match that isn't waiting and a record that is theirs. */
  const runner = () => room.isHost && room.running && H.g !== null && H.g.mid === room.match.id && H.g.by === me;
  const hosting = () => runner() && H.round !== null && H.round.rid === H.g.rid;
  /** The host's world exists (even while the match waits for players): what it shows is the truth. */
  const hasWorld = () => room.isHost && H.g !== null && H.g.mid === room.match.id && H.g.by === me && H.round !== null && H.round.rid === H.g.rid;
  const engineHasMe = () => hasWorld() && roundLive(H.g.phase) && H.round.players.has(me);

  const defNow = () => (engineHasMe() ? H.round.players.get(me).def : L.def);
  const defClock = () => (engineHasMe() ? H.round.t : L.clock);

  // ---------------------------------------------------------------- places
  const slotOf = (id) => {
    const r = S.idx.get(id);
    return r && S.slots.length ? S.slots[r.idx % S.slots.length] : null;
  };

  function lobbyBody() {
    const s = lobbySpot(me);
    return makeBody(s.x, s.z, s.yaw);
  }

  /** Where a player is, for drawing: `out` is filled and returned (or null if nobody knows). */
  function pose(id, out = {}) {
    if (id === me) {
      const b = L.body;
      if (!b) return null;
      out.x = b.x;
      out.y = b.y;
      out.z = b.z;
      out.r = b.yaw;
      out.sw = defNow().presses;
      return out;
    }
    const rec = S.idx.get(id);
    const inMatch = room.match.phase !== 'lobby';
    if (rec && rec.bot) return botPose(id, out);
    const pa = room.presenceAt(id, { angles: ['r'], snap: 6 });
    if (pa && isNum(pa.x) && isNum(pa.y) && isNum(pa.z)) {
      out.x = pa.x;
      out.y = pa.y;
      out.z = pa.z;
      out.r = num(pa.r);
      out.sw = num(pa.sw);
      return out;
    }
    if (inMatch) {
      const s = slotOf(id);
      if (s) {
        out.x = s.x;
        out.y = 0;
        out.z = s.z;
        out.r = s.yaw;
        out.sw = 0;
        return out;
      }
    }
    return null;
  }

  function botPose(id, out) {
    if (hasWorld()) {
      const p = H.round.players.get(id);
      if (p) {
        out.x = p.body.x;
        out.y = p.body.y;
        out.z = p.body.z;
        out.r = p.body.yaw;
        out.sw = p.def.presses;
        return out;
      }
    }
    const j = S.botOrder.findIndex((r) => r.id === id);
    const buf = V.bots;
    if (j >= 0 && buf.length) {
      const rt = room.matchNow() - 110;
      let a = buf[0];
      let b = buf[0];
      for (let i = 0; i < buf.length; i++) {
        if (buf[i].t <= rt) a = b = buf[i];
        else {
          b = buf[i];
          break;
        }
      }
      const ka = a.k[j];
      const kb = b.k[j];
      const k = Array.isArray(kb) ? kb : ka;
      if (Array.isArray(ka) && Array.isArray(k)) {
        const f = b.t > a.t ? clamp((rt - a.t) / (b.t - a.t), 0, 1) : 0;
        out.x = ka[0] + (k[0] - ka[0]) * f;
        out.y = ka[1] + (k[1] - ka[1]) * f;
        out.z = ka[2] + (k[2] - ka[2]) * f;
        out.r = lerpAngle(ka[3], k[3], f);
        out.sw = k[4];
        return out;
      }
    }
    const s = slotOf(id);
    if (s) {
      out.x = s.x;
      out.y = 0;
      out.z = s.z;
      out.r = s.yaw;
      out.sw = 0;
      return out;
    }
    return null;
  }

  const TP = { x: 0, y: 0, z: 0 };
  /** The latest known chest position of a player (what the ball homes on), or null. */
  function chestOf(id) {
    if (id === me) {
      if (!L.body) return null;
      TP.x = L.body.x;
      TP.y = L.body.y + CHEST;
      TP.z = L.body.z;
      return TP;
    }
    const rec = S.idx.get(id);
    if (!rec) return null;
    if (rec.bot) {
      const k = V.botNow.get(id);
      if (k) {
        TP.x = k[0];
        TP.y = k[1] + CHEST;
        TP.z = k[2];
        return TP;
      }
    } else {
      const pr = room.players.get(id)?.presence;
      if (pr && isNum(pr.x) && isNum(pr.y) && isNum(pr.z)) {
        TP.x = pr.x;
        TP.y = pr.y + CHEST;
        TP.z = pr.z;
        return TP;
      }
    }
    const s = slotOf(id);
    if (!s) return null;
    TP.x = s.x;
    TP.y = CHEST;
    TP.z = s.z;
    return TP;
  }

  // ---------------------------------------------------------------- the ball, as this page has it
  const NOBALL = makeBall();
  function ballView() {
    const ph = phase();
    if (ph === 'lobby') return practice.ball;
    if (ph === 'starting') return NOBALL;
    if (hasWorld()) return H.round.ball;
    return V.ball;
  }
  const clashNow = () => (hasWorld() ? H.round.clashNow() : V.clash);

  function resetView() {
    V.ball = makeBall();
    V.have = false;
    V.ex = V.ey = V.ez = 0;
    V.localN = -1;
    V.localAt = -1;
    V.bots = [];
    V.botNow = new Map();
    V.clash = 0;
  }

  /** The host's latest snapshot, checked. */
  function readSnap(s, g) {
    if (!s || typeof s !== 'object' || !g || s.r !== g.rid) return null;
    if (!isNum(s.t) || !isNum(s.n) || !isNum(s.s) || !isVec(s.p) || !isVec(s.v)) return null;
    if (!(s.n >= 0 && s.n < 1e6) || !(s.s >= 0 && s.s <= 400)) return null;
    return s;
  }

  function ballFromSnap(s) {
    const roster = S.roster;
    const b = makeBall();
    b.x = b.px = clamp(s.p[0], -500, 500);
    b.y = b.py = clamp(s.p[1], -100, 200);
    b.z = b.pz = clamp(s.p[2], -500, 500);
    b.vx = s.v[0];
    b.vy = s.v[1];
    b.vz = s.v[2];
    b.speed = s.s;
    b.n = s.n | 0;
    b.active = s.a === 1;
    b.pend = s.z === 1 || s.z === 2 ? s.z : 0;
    b.target = isNum(s.ti) && s.ti >= 0 && roster[s.ti] ? roster[s.ti].id : null;
    b.by = isNum(s.bi) && s.bi >= 0 && roster[s.bi] ? roster[s.bi].id : null;
    return b;
  }

  function botsFromSnap(s) {
    const out = {};
    if (!Array.isArray(s.k)) return out;
    S.botOrder.forEach((r, j) => {
      const k = s.k[j];
      if (Array.isArray(k) && k.length >= 5 && k.every(isNum)) out[r.id] = { x: k[0], y: k[1], z: k[2], yaw: k[3] };
    });
    return out;
  }

  function fastForward(b, secs) {
    let left = secs;
    while (left > 1e-6) {
      const dt = Math.min(STEP, left);
      left -= dt;
      const tp = b.target ? chestOf(b.target) : null;
      if (!tp) break;
      stepBall(b, tp.x, tp.y, tp.z, dt);
    }
  }

  /** The host's word on the ball (a page that isn't the host): run it forward to now and fold it into what we show. */
  function onSnap(s) {
    const g = G();
    if (!g || hasWorld()) return;
    rosterNow();
    s = readSnap(s, g);
    if (!s) return;
    if (Array.isArray(s.k)) {
      V.bots.push({ t: s.t, k: s.k });
      while (V.bots.length > 8) V.bots.shift();
      S.botOrder.forEach((r, j) => {
        const k = s.k[j];
        if (Array.isArray(k) && k.length >= 5 && k.every(isNum)) V.botNow.set(r.id, k);
      });
    }
    V.clash = isNum(s.c) ? s.c | 0 : 0;
    if (V.localN > s.n && L.clock - V.localAt < 0.7) return; // our own deflect is ahead of the host's word on it
    const nb = ballFromSnap(s);
    if (nb.active && nb.pend === 0) fastForward(nb, clamp((room.matchNow() - s.t) / 1000, 0, 0.4));
    const old = V.ball;
    const fresh = !V.have || !old.active || old.n !== nb.n || old.target !== nb.target || old.pend !== nb.pend || Math.hypot(old.x - nb.x, old.y - nb.y, old.z - nb.z) > 8;
    if (fresh) V.ex = V.ey = V.ez = 0;
    else {
      V.ex = old.x + V.ex - nb.x;
      V.ey = old.y + V.ey - nb.y;
      V.ez = old.z + V.ez - nb.z;
      if (Math.hypot(V.ex, V.ey, V.ez) > 4) V.ex = V.ey = V.ez = 0;
    }
    if (!V.have || nb.n < S.lastN) S.lastN = nb.n; // the first word on a round we joined late (or the host turned one of ours down): not a deflect to play
    V.ball = nb;
    V.have = true;
    V.localN = nb.n;
  }

  function stepView(dt) {
    const b = V.ball;
    if (!V.have || !b.active || b.pend) return;
    const tp = b.target ? chestOf(b.target) : null;
    if (!tp) return;
    stepBall(b, tp.x, tp.y, tp.z, dt);
    if (b.target === me && L.body && inRoster() && meAlive() && sweptHit(b, L.body.x, L.body.y + CHEST, L.body.z, HIT_R)) localImpact(b);
  }

  /** The ball reached me. My page decides whether the window was open. */
  function localImpact(b) {
    const to = windowOpen(L.def, L.clock) ? pickLocal() : null;
    const tp = to ? chestOf(to) : null;
    if (to && tp) {
      const lead = L.clock - L.def.winStart;
      const n0 = b.n;
      b.by = me;
      b.target = to;
      redirectBall(b, tp.x, tp.y, tp.z);
      deflectWorked(L.def, L.clock);
      V.localN = b.n;
      V.localAt = L.clock;
      try {
        room.send({ t: 'deflect', rid: S.rid, n: n0, to, aim: round2(L.aim) }, { to: room.host });
      } catch {
        /* the room is gone: the host will judge it */
      }
      emit('mydeflect', { lead, speed: b.speed, perfect: lead <= PERFECT_S });
    } else {
      b.pend = 1;
      S.hitAt = L.clock;
      emit('myimpact', {});
    }
  }

  function pickLocal() {
    const cands = [];
    const g = G();
    const out = gOut(g);
    for (const r of S.roster) {
      if (r.id === me || out.includes(r.id)) continue;
      const c = chestOf(r.id);
      if (c) cands.push({ id: r.id, x: c.x, z: c.z });
    }
    return pickTarget(L.body.x, L.body.z, L.aim, cands, me);
  }

  // ---------------------------------------------------------------- the host runs the rules
  function makeEngine(g) {
    const roster = g.roster.map((r) => ({ id: r.id, bot: !!r.b }));
    return new Round({ rid: g.rid, roster, slots: spawnSlots(roster.length, g.rid), seed: hashString(g.rid), brains: H.brains });
  }

  function flushG(force = false) {
    if (!H.dirty || !H.g) return;
    const t = clock();
    if (!force && t - H.gAt < 100) return;
    H.gAt = t;
    H.dirty = false;
    room.setState('g', clone(H.g));
  }
  function commit(urgent) {
    H.dirty = true;
    flushG(urgent);
  }

  function hostStartMatch() {
    const m = room.match;
    const roster = buildRoster(m.participants, m.seed);
    const rounds = Math.round(num(room.settings.rounds, ROUND_DEFAULT));
    H.g = {
      mid: m.id, by: me, n: 0, rid: null, phase: 'wait', until: 0, t0: 0, rounds: clamp(rounds, 1, 9),
      roster: roster.map((r) => (r.bot ? { id: r.id, b: 1, nm: r.name } : { id: r.id })),
      scores: Object.fromEntries(roster.map((r) => [r.id, 0])), tot: {}, out: [], dc: {}, win: null, gain: null, rr: null, fr: null, aw: null, cw: null,
      ts: [null, 0], bc: [null, 0],
    };
    H.round = null;
    H.endedFor = null;
    commit(true);
    hostNextRound();
  }

  function hostNextRound() {
    const g = H.g;
    const n = g.n + 1;
    if (n > g.rounds) return hostFinal();
    const now = room.matchNow();
    g.n = n;
    g.rid = `${g.mid}.${n}`;
    g.t0 = Math.round(now);
    g.phase = 'intro';
    g.until = g.t0 + INTRO_S * 1000;
    g.out = [];
    g.dc = {};
    g.win = null;
    g.gain = null;
    g.rr = null;
    g.cw = null;
    H.round = makeEngine(g);
    H.lastNow = now;
    H.acc = 0;
    H.snapAt = -1e9;
    commit(true);
  }

  function hostRoundOver(winner) {
    const g = H.g;
    const r = H.round;
    const order = r.order();
    const gain = roundGain(order, r.deflectCounts());
    g.scores = addScores(g.scores, gain);
    g.gain = gain;
    g.win = winner;
    g.rr = order;
    g.phase = 'over';
    g.until = Math.round(room.matchNow() + OVER_MS);
    for (const [id, n] of Object.entries(r.deflectCounts())) g.tot[id] = (g.tot[id] ?? 0) + n;
    if (r.stats.topSpeed[1] > g.ts[1]) g.ts = [r.stats.topSpeed[0], r.stats.topSpeed[1]];
    if (r.stats.bestClash[1] > g.bc[1]) g.bc = [r.stats.bestClash[0], r.stats.bestClash[1]];
    publishSnap(room.matchNow(), true);
    commit(true);
  }

  function hostFinal() {
    const g = H.g;
    const roster = g.roster.map((r) => ({ id: r.id }));
    g.fr = rankMatch(roster, g.scores, g.tot);
    g.aw = awardsFrom({ totals: g.tot, topSpeed: g.ts, bestClash: g.bc });
    g.phase = 'final';
    g.until = Math.round(room.matchNow() + FINAL_MS);
    H.round = null;
    commit(true);
  }

  /** What the engine tells us, written into the record. */
  function processEvents(events) {
    const g = H.g;
    for (const e of events) {
      if (e.type === 'play') {
        g.phase = 'play';
        g.until = 0;
        commit(true);
      } else if (e.type === 'deflect') {
        g.dc[e.by] = (g.dc[e.by] ?? 0) + 1;
        commit(false);
        if (e.by === me) emit('mydeflect', { lead: e.lead, speed: e.speed, perfect: isNum(e.lead) && e.lead <= PERFECT_S });
      } else if (e.type === 'out') {
        if (!g.out.includes(e.id)) g.out.push(e.id);
        commit(true);
      } else if (e.type === 'clashWon') {
        g.cw = { id: e.id, n: e.n, rid: g.rid };
        commit(true);
      } else if (e.type === 'done') hostRoundOver(e.winner);
    }
  }

  function feedHost(r) {
    const q = qOf(r.rid);
    for (const p of r.list) {
      if (p.bot) continue;
      if (p.id === me) {
        if (L.body && S.rid === r.rid) {
          r.setPos(me, L.body.x, L.body.y, L.body.z, L.body.yaw);
          r.setAim(me, L.aim);
        }
        r.setJudged(me, true);
        continue;
      }
      const pl = room.players.get(p.id);
      r.setJudged(p.id, !pl || pl.connected === false);
      const pr = pl && pl.presence;
      if (pr && typeof pr === 'object' && pr.q === q && isNum(pr.x) && isNum(pr.y) && isNum(pr.z)) r.setPos(p.id, pr.x, pr.y, pr.z, num(pr.r));
    }
  }

  function hostAdvance() {
    if (!hosting()) return;
    const r = H.round;
    const g = H.g;
    if (!roundLive(g.phase) || r.over) return;
    const now = room.matchNow();
    let dt = (now - H.lastNow) / 1000;
    H.lastNow = now;
    if (!(dt > 0)) return;
    H.acc += Math.min(dt, 0.25);
    feedHost(r);
    while (H.acc >= STEP && !r.over) {
      r.step(STEP);
      H.acc -= STEP;
      processEvents(r.drain());
      if (!hosting()) return; // the round changed under us (a record written)
    }
    if (r.over) {
      H.acc = 0;
      return;
    }
    if (g.phase === 'play') {
      const hz = clamp(Math.floor((room.budget?.messagesPerSecond ?? 40) * 0.5), SNAP_HZ_MIN, SNAP_HZ_MAX);
      if (now - H.snapAt >= 1000 / hz) {
        H.snapAt = now;
        publishSnap(now, false);
      }
    }
  }

  function publishSnap(now, last) {
    const r = H.round;
    const g = H.g;
    if (!r || !g) return;
    rosterNow();
    const b = r.ball;
    const ti = b.target ? (S.idx.get(b.target)?.idx ?? -1) : -1;
    const bi = b.by ? (S.idx.get(b.by)?.idx ?? -1) : -1;
    const k = r.roster
      .filter((x) => x.bot)
      .map((x) => {
        const p = r.players.get(x.id);
        return p && p.alive ? [round2(p.body.x), round2(p.body.y), round2(p.body.z), round2(p.body.yaw), p.def.presses] : 0;
      });
    room.setState('b', {
      r: r.rid, t: Math.round(now), a: b.active ? 1 : 0, n: b.n, s: r1(b.speed),
      p: [round2(b.x), round2(b.y), round2(b.z)], v: [r1(b.vx), r1(b.vy), r1(b.vz)],
      ti, bi, z: b.pend, c: r.clashNow(), k, ...(last ? { l: 1 } : {}),
    });
  }

  function endMatchOnce() {
    const t = clock();
    if (H.endedFor === H.g.mid && t - H.endAt < 2500) return;
    H.endedFor = H.g.mid;
    H.endAt = t;
    room.endMatch();
  }

  /** Carry on as the host, from room state: safe to call as often as you like. */
  function adopt() {
    if (!room.isHost || !room.running) return;
    const g = G();
    if (!g) {
      hostStartMatch();
      return;
    }
    if (g.by !== me || !H.g || H.g.mid !== g.mid) {
      H.g = clone(g);
      H.g.by = me;
      if (!Array.isArray(H.g.out)) H.g.out = [];
      if (typeof H.g.dc !== 'object' || !H.g.dc) H.g.dc = {};
      if (typeof H.g.tot !== 'object' || !H.g.tot) H.g.tot = {};
      if (!Array.isArray(H.g.ts)) H.g.ts = [null, 0];
      if (!Array.isArray(H.g.bc)) H.g.bc = [null, 0];
      H.round = null;
      commit(true);
    }
    ensureEngine();
  }

  function ensureEngine() {
    const g = H.g;
    if (!g || !roundLive(g.phase) || !Array.isArray(g.roster)) {
      if (g && !roundLive(g.phase)) H.round = null;
      return;
    }
    if (H.round && H.round.rid === g.rid) return;
    rosterNow();
    H.round = makeEngine(g);
    const now = room.matchNow();
    const s = readSnap(room.state.b, g);
    H.round.resume({
      t: Math.max(0, (now - num(g.t0)) / 1000),
      outs: g.out,
      deflects: g.dc,
      ball: s ? ballFromSnap(s) : null,
      bots: s ? botsFromSnap(s) : null,
    });
    H.lastNow = now;
    H.acc = 0;
    processEvents(H.round.drain());
  }

  function dropHost() {
    H.g = null;
    H.round = null;
    H.dirty = false;
  }

  function tick() {
    if (!room.isHost) {
      if (H.g || H.round) dropHost();
      return;
    }
    if (!room.running) return;
    if (!H.g || H.g.mid !== room.match.id || !G() || G().by !== me) adopt();
    if (!H.g) return;
    ensureEngine();
    hostAdvance();
    const g = H.g;
    if (!g) return;
    const now = room.matchNow();
    if (g.phase === 'over' && now >= g.until) hostNextRound();
    else if (g.phase === 'final' && now >= g.until) endMatchOnce();
    flushG();
  }

  room.on('message', (d, from) => {
    if (!hosting() || !d || d.t !== 'deflect' || d.rid !== H.g.rid || !from) return;
    if (!room.match.participants?.includes(from.id)) return;
    if (!Number.isInteger(d.n) || d.n < 0 || (d.to !== undefined && typeof d.to !== 'string')) return;
    const ok = H.round.humanDeflect(from.id, { n: d.n, to: d.to, aim: isNum(d.aim) ? d.aim : undefined });
    if (ok) {
      processEvents(H.round.drain());
      if (hosting() && H.g.phase === 'play') {
        H.snapAt = room.matchNow();
        publishSnap(room.matchNow(), false);
      }
    }
  });
  room.on('state', (key, value) => {
    if (key === 'b') onSnap(value);
  });
  room.on('matchstart', () => {
    resetMatchMemory();
    adopt();
  });
  room.on('host', adopt);
  room.on('reconnect', adopt);
  room.on('matchend', () => {
    resetMatchMemory();
    dropHost();
    L.body = lobbyBody();
    resetPractice(practice);
  });
  const timer = setTimer(() => {
    try {
      tick();
    } catch (err) {
      console.error('[deflect-ball] tick', err);
    }
  }, 100);

  function resetMatchMemory() {
    S.rid = null;
    S.rosterKey = null;
    S.roster = [];
    S.idx = new Map();
    S.botOrder = [];
    S.slots = [];
    S.seenOut = 0;
    S.fired = new Set();
    S.lastN = 0;
    S.lastClash = 0;
    S.first = false;
    resetView();
  }

  // ---------------------------------------------------------------- a new round, seen by this page
  function syncRound(g) {
    if (!g || typeof g.rid !== 'string' || g.rid === S.rid) return;
    rosterNow();
    const firstSeen = S.rid === null;
    S.rid = g.rid;
    S.slots = spawnSlots(S.roster.length, g.rid);
    S.seenOut = firstSeen && S.first ? gOut(g).length : 0;
    S.lastN = 0;
    S.lastClash = 0;
    resetView();
    L.def = makeDeflector();
    let restored = false;
    if (inRoster() && roundLive(g.phase)) {
      const pr = room.me.presence;
      if (S.restoreOnce && firstSeen && pr && pr.q === qOf(g.rid) && isNum(pr.x) && isNum(pr.y) && isNum(pr.z)) {
        L.body = makeBody(pr.x, pr.z, num(pr.r));
        L.body.y = pr.y;
        L.body.ground = pr.y <= 0.01;
        restored = true;
      } else {
        const s = slotOf(me);
        if (s) L.body = makeBody(s.x, s.z, s.yaw);
      }
    }
    S.restoreOnce = false;
    L.lastKey = '';
    emit('round', { rid: g.rid, n: g.n, total: g.rounds, restored });
  }

  // ---------------------------------------------------------------- per fixed step, per frame
  const canControl = (ph) => {
    if (!L.active || room.spectating) return false;
    if (ph === 'lobby' || ph === 'starting') return true;
    if (ph === 'intro' || ph === 'play') return inRoster() && meAlive();
    return false;
  };

  /** One fixed step (1/60 s) of everything this page simulates: my body, my deflect button, the ball as I see it, the practice ball. */
  function step(dt, input = {}) {
    if (!L.active) return;
    const m = room.match;
    if (m.phase === 'playing' && m.paused) return;
    L.clock += dt;
    const ph = phase();
    if (!L.body) L.body = lobbyBody();
    L.aim = num(input.aim, L.aim);
    if (canControl(ph)) {
      stepBody(L.body, { mx: num(input.mx), mz: num(input.mz), jump: !!input.jump, dash: !!input.dash, face: input.face }, dt);
      if (L.body.dashed) L.flags.dashed = true;
      if (L.body.jumped) L.flags.jumped = true;
      if (L.body.landed) L.flags.landed = true;
      if (input.press || L.pressQ) {
        L.pressQ = false;
        const ok = engineHasMe() ? H.round.press(me) : pressDeflect(L.def, L.clock);
        emit('press', { ok });
      }
    } else L.pressQ = false;
    if (ph === 'lobby') {
      stepPractice(practice, L.body, L.def, L.clock, dt);
      if (practice.events.length) {
        for (const e of practice.events) emit('practice', e);
        practice.events.length = 0;
      }
    } else if (ph === 'play' && !hasWorld()) stepView(dt);
    // the hit I'm waiting on: if the host never writes it, the ball goes on (it was a miss on their side)
    if (V.ball.pend === 1 && S.hitAt >= 0 && L.clock - S.hitAt > 1.6) {
      V.ball.pend = 0;
      S.hitAt = -1;
    }
  }

  /** Whatever happened to my body since the last call (for sound and dust). */
  function takeFlags() {
    const f = L.flags;
    const out = { dashed: f.dashed, jumped: f.jumped, landed: f.landed };
    f.dashed = f.jumped = f.landed = false;
    return out;
  }

  const fire = (key) => {
    if (S.fired.has(key)) return false;
    S.fired.add(key);
    return true;
  };

  function publishPresence() {
    if (!L.active || !L.body || room.spectating) return;
    const ph = phase();
    if (room.match.phase === 'playing') {
      if (!inRoster()) return;
      if (roundLive(ph) && !meAlive()) return;
    }
    const t = clock();
    if (t - L.lastSent < PRESENCE_MS) return;
    const b = L.body;
    const rid = S.rid;
    const q = room.match.phase === 'playing' && rid && roundLive(ph) ? qOf(rid) : 0;
    const p = { x: round2(b.x), y: round2(b.y), z: round2(b.z), r: round2(b.yaw), sw: defNow().presses, q };
    const key = `${p.x},${p.y},${p.z},${p.r},${p.sw},${p.q}`;
    if (key === L.lastKey && t - L.lastSent < 400) return;
    L.lastKey = key;
    L.lastSent = t;
    room.setPresence(p);
  }

  /** Once per rendered frame, after the fixed steps. */
  function frame(dt) {
    syncRoundMaybe();
    hostAdvance();
    publishPresence();
    const k = Math.exp(-dt / 0.09);
    V.ex *= k;
    V.ey *= k;
    V.ez *= k;
    emitDiffs();
  }

  function syncRoundMaybe() {
    if (room.match.phase !== 'playing') return;
    const g = G();
    if (g && g.rid) syncRound(g);
  }

  function emitDiffs() {
    const ph = phase();
    if (ph !== S.lastPhase) {
      const prev = S.lastPhase;
      S.lastPhase = ph;
      if (ph === 'lobby' && prev !== 'lobby' && prev !== 'starting') L.body = lobbyBody();
      if (ph === 'starting') resetPractice(practice);
      emit('phase', { phase: ph, prev });
    }
    if (room.match.phase !== 'playing') return;
    const g = G();
    if (!g || typeof g.rid !== 'string') return;
    rosterNow();
    const outs = gOut(g);
    const b = ballView();
    if (S.first) {
      // a page that loaded mid-match doesn't replay what already happened
      S.first = false;
      S.seenOut = outs.length;
      S.lastN = b.n;
      if (g.phase !== 'intro') S.fired.add(`${g.rid}:play`);
      if (g.phase === 'over' || g.phase === 'final') S.fired.add(`${g.rid}:over`);
      if (g.phase === 'final') S.fired.add(`${g.mid}:final`);
      if (g.cw && g.cw.rid === g.rid) S.fired.add(`${g.rid}:cw`);
    }
    while (S.seenOut < outs.length) {
      const id = outs[S.seenOut++];
      const at = pose(id, {});
      emit('out', { id, at, me: id === me });
    }
    if (g.phase === 'play' && fire(`${g.rid}:play`)) emit('play', { rid: g.rid });
    if (g.phase === 'over' && fire(`${g.rid}:over`)) emit('over', { g });
    if (g.phase === 'final' && fire(`${g.mid}:final`)) {
      S.last = { g: clone(g), roster: S.roster.map((r) => ({ ...r })) };
      emit('final', S.last);
    }
    if (g.cw && g.cw.rid === g.rid && typeof g.cw.id === 'string' && fire(`${g.rid}:cw`)) emit('clashwon', g.cw);
    if (g.phase === 'play' && b.active) {
      if (b.n > S.lastN) {
        S.lastN = b.n;
        emit('deflect', { by: b.by, to: b.target, n: b.n, speed: b.speed, mine: b.by === me });
      }
      const c = clashNow();
      if (c !== S.lastClash) {
        S.lastClash = c;
        if (c >= CLASH_MIN) emit('clash', { n: c, a: b.by, b: b.target });
      }
    }
  }

  if (room.match.phase === 'playing') onSnap(room.state.b);

  // ---------------------------------------------------------------- what the page reads and calls
  return {
    me,
    on,
    step,
    frame,
    adopt,
    takeFlags,
    pose,
    ballView,
    clashNow,
    qOf,
    /** Deflect pressed (key, click or touch). */
    press() {
      L.pressQ = true;
    },
    /** The player pressed Play: the world starts to be theirs. */
    setActive(on) {
      L.active = !!on;
      if (on && !L.body) L.body = lobbyBody();
    },
    get active() {
      return L.active;
    },
    get phase() {
      return phase();
    },
    get g() {
      return G();
    },
    get roster() {
      return rosterNow();
    },
    rec: (id) => {
      rosterNow();
      return S.idx.get(id) ?? null;
    },
    get inRoster() {
      return inRoster();
    },
    get alive() {
      return meAlive();
    },
    isOut: (id) => gOut(G()).includes(id),
    get body() {
      return L.body;
    },
    get aim() {
      return L.aim;
    },
    /** 0..1 how far off cooldown is the button, and whether the window is open now. */
    deflector() {
      const d = defNow();
      const now = defClock();
      return { frac: cooldownFrac(d, now), open: windowOpen(d, now) };
    },
    /** Who the ball would go to if I deflected it now (the id), or null. */
    aimPick() {
      if (!L.body || !L.active) return null;
      const ph = phase();
      if (ph === 'lobby' || ph === 'starting' || !inRoster() || !meAlive()) return null;
      return pickLocal();
    },
    /** The error offset of the drawn ball (smooths the host's corrections). */
    ballOffset: V,
    practice,
    get last() {
      return S.last;
    },
    get hosting() {
      return hosting();
    },
    stop() {
      clearTimer(timer);
    },
    _internals: { H, V, S, L, tick },
  };
}
