// One round, as the host runs it: players, bots, the ball, deflects, eliminations, the clash count. Pure: it is fed
// positions and presses and hands back events, so node can play whole matches through it.
import {
  CHEST, HIT_R, BALL_R, GRACE, LEAD, HOLD_S, INTRO_S, SPEED_START, SPEED_MAX, SUDDEN_DEATH_S, CLASH_GAP, CLASH_KING,
} from './config.js';
import {
  makeBody, stepBody, makeBall, makeDeflector, pressDeflect, windowOpen, deflectWorked, stepBall, sweptHit, redirectBall, aimBall,
  pickTarget, fellOut, rampAt,
} from './sim.js';
import { makeBrain, think, chooseTo } from './bots.js';
import { mulberry32, hashString } from './rng.js';
import { placementOrder } from './match.js';


export class Round {
  /**
   * @param {object} o
   * @param {string} o.rid unique round id
   * @param {{id:string,bot:boolean}[]} o.roster everyone in the round, in roster order
   * @param {{x:number,z:number,yaw:number}[]} o.slots one starting spot per roster entry
   * @param {number|string} o.seed for the round's randomness (target picks, bots)
   * @param {Map<string,object>} [o.brains] bot brains kept across rounds (personalities)
   * @param {number} [o.speedStart] the ball's first speed
   * @param {number} [o.rampScale] multiplies the ball's time ramp (the title screen's quick rounds)
   * @param {number} [o.introS] seconds before the ball appears
   */
  constructor(o) {
    this.rid = o.rid;
    this.rng = mulberry32(typeof o.seed === 'number' ? o.seed >>> 0 : hashString(o.seed));
    this.roster = o.roster;
    this.t = 0;
    this.introS = o.introS ?? INTRO_S;
    this.phase = 'intro'; // intro | play | done
    this.speedStart = o.speedStart ?? SPEED_START;
    this.rampScale = o.rampScale ?? 1;
    this.ball = makeBall();
    this.ball.speed = this.speedStart;
    this.outs = [];
    this.events = [];
    this.winner = null;
    this.clash = { n: 0, last: null, prev: null, lastT: -99 };
    this.stats = { topSpeed: [null, 0], bestClash: [null, 0] };
    this.players = new Map();
    this.list = [];
    o.roster.forEach((r, i) => {
      const s = o.slots[i % o.slots.length];
      const p = {
        id: r.id, idx: i, bot: !!r.bot, judged: !!r.bot, alive: true,
        body: makeBody(s.x, s.z, s.yaw), def: makeDeflector(), brain: null, aim: s.yaw, deflects: 0, outAt: -1,
      };
      if (p.bot) {
        p.brain = o.brains?.get(r.id) ?? makeBrain(this.rng);
        p.brain.plan = null;
        o.brains?.set(r.id, p.brain);
      }
      this.players.set(r.id, p);
      this.list.push(p);
    });
  }

  alivePlayers() {
    return this.list.filter((p) => p.alive);
  }
  aliveCount() {
    let n = 0;
    for (const p of this.list) if (p.alive) n++;
    return n;
  }
  get over() {
    return this.phase === 'done';
  }
  /** Seconds since the ball appeared. */
  get ballAge() {
    return this.ball.age;
  }

  // ---------------------------------------------------------------- what the host feeds in
  /** A human's reported position (from presence): the engine trusts it only so far. */
  setPos(id, x, y, z, yaw) {
    const p = this.players.get(id);
    if (!p || p.bot || !p.alive) return;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    const b = p.body;
    b.x = Math.max(-200, Math.min(200, x));
    b.z = Math.max(-200, Math.min(200, z));
    b.y = Math.max(-60, Math.min(40, y));
    if (Number.isFinite(yaw)) b.yaw = yaw;
  }
  /** Judged by the host: the host's own player and players who are away (no deflect will ever come for them). */
  setJudged(id, judged) {
    const p = this.players.get(id);
    if (p && !p.bot) p.judged = !!judged;
  }
  setAim(id, yaw) {
    const p = this.players.get(id);
    if (p && Number.isFinite(yaw)) p.aim = yaw;
  }
  /** A judged player presses Deflect. */
  press(id) {
    const p = this.players.get(id);
    if (!p || !p.alive || this.phase === 'done') return false;
    return pressDeflect(p.def, this.t);
  }

  // ---------------------------------------------------------------- the step
  step(dt) {
    if (this.phase === 'done') return;
    this.t += dt;
    if (this.phase === 'intro') {
      if (this.t >= this.introS) this.startPlay();
      return;
    }
    const alive = this.alivePlayers();
    const others = alive.map((p) => ({ id: p.id, x: p.body.x, z: p.body.z, deflects: p.deflects }));
    for (const p of alive) {
      if (!p.bot) continue;
      const inp = think(p.brain, p, { t: this.t, ball: this.ball, others }, dt, this.rng);
      if (inp.press) pressDeflect(p.def, this.t);
      stepBody(p.body, inp, dt);
    }
    for (const p of alive) if (p.alive && fellOut(p.body)) this.eliminate(p, 'fall');
    if (this.phase === 'done') return;
    this.stepBall(dt);
  }

  startPlay() {
    this.phase = 'play';
    const alive = this.alivePlayers();
    const b = this.ball;
    b.active = true;
    b.x = b.px = 0;
    b.y = b.py = 1.6;
    b.z = b.pz = 0;
    b.speed = this.speedStart;
    b.age = 0;
    b.n = 0;
    b.by = null;
    this.retarget(alive);
    this.events.push({ type: 'play' });
  }

  retarget(alive = this.alivePlayers()) {
    const b = this.ball;
    if (alive.length === 0) return;
    const to = alive[Math.floor(this.rng() * alive.length) % alive.length];
    b.target = to.id;
    b.lock++;
    b.pend = 0;
    b.pendT = 0;
    b.hold = 0;
    aimBall(b, to.body.x, to.body.y + CHEST, to.body.z);
  }

  stepBall(dt) {
    const b = this.ball;
    if (!b.active) return;
    if (b.pend === 2) {
      b.hold -= dt;
      if (b.hold <= 0) this.retarget();
      return;
    }
    if (b.pend === 1) {
      b.pendT += dt;
      if (b.pendT >= GRACE) {
        const tp = this.players.get(b.target);
        if (tp && tp.alive) this.eliminate(tp, 'hit');
        else this.retarget();
      }
      return;
    }
    const tp = this.players.get(b.target);
    if (!tp || !tp.alive) {
      this.retarget();
      return;
    }
    b.age += dt;
    // once every person is out the bots finish it quickly: a spectator isn't kept waiting
    const hurry = this.list.some((p) => !p.bot) && !this.list.some((p) => !p.bot && p.alive) ? 4 : 1;
    b.speed = Math.min(SPEED_MAX, b.speed + rampAt(b.age) * this.rampScale * hurry * dt);
    const cy = tp.body.y + CHEST;
    stepBall(b, tp.body.x, cy, tp.body.z, dt);
    if (sweptHit(b, tp.body.x, cy, tp.body.z, HIT_R)) this.impact(tp);
  }

  impact(tp) {
    const b = this.ball;
    const forced = b.age > SUDDEN_DEATH_S;
    if (tp.judged) {
      if (!forced && windowOpen(tp.def, this.t)) this.deflect(tp, this.nextFor(tp));
      else this.eliminate(tp, 'hit');
    } else {
      // A person on another page decides their own deflect: the ball waits for it for a moment.
      b.pend = 1;
      b.pendT = 0;
      this.events.push({ type: 'impact', id: tp.id });
    }
  }

  /** Who a judged player's deflect goes to. */
  nextFor(tp) {
    const cands = this.alivePlayers().filter((p) => p !== tp);
    if (cands.length === 0) return null;
    if (tp.bot) return chooseTo(tp.brain, cands.map((p) => ({ id: p.id, deflects: p.deflects })), this.rng);
    return pickTarget(tp.body.x, tp.body.z, tp.aim, cands.map((p) => ({ id: p.id, x: p.body.x, z: p.body.z })), tp.id);
  }

  /** A person's deflect, decided on their page: { n, to, aim }. True if the ball took it. */
  humanDeflect(id, msg) {
    const b = this.ball;
    if (this.phase !== 'play' || !b.active) return false;
    const p = this.players.get(id);
    if (!p || !p.alive || p.bot) return false;
    if (b.age > SUDDEN_DEATH_S) return false;
    if (!msg || msg.n !== b.n || b.target !== id || b.pend === 2) return false;
    if (b.pend !== 1) {
      const d = Math.hypot(b.x - p.body.x, b.y - (p.body.y + CHEST), b.z - p.body.z);
      if (d > HIT_R + BALL_R + b.speed * LEAD) return false; // far too early to be the same ball
    }
    const cands = this.alivePlayers().filter((q) => q !== p);
    if (cands.length === 0) return false;
    let to = typeof msg.to === 'string' ? this.players.get(msg.to) : null;
    if (!to || !to.alive || to === p) {
      const aim = Number.isFinite(msg.aim) ? msg.aim : p.aim;
      to = this.players.get(pickTarget(p.body.x, p.body.z, aim, cands.map((q) => ({ id: q.id, x: q.body.x, z: q.body.z })), p.id));
    }
    if (!to) return false;
    this.deflect(p, to.id);
    return true;
  }

  deflect(p, toId) {
    const b = this.ball;
    let to = toId ? this.players.get(toId) : null;
    if (!to || !to.alive || to === p) {
      const cands = this.alivePlayers().filter((q) => q !== p);
      if (cands.length === 0) {
        this.eliminate(p, 'hit');
        return;
      }
      to = cands[Math.floor(this.rng() * cands.length) % cands.length];
    }
    b.by = p.id;
    b.target = to.id;
    redirectBall(b, to.body.x, to.body.y + CHEST, to.body.z);
    deflectWorked(p.def, this.t);
    p.deflects++;
    this.noteClash(p);
    if (b.speed > this.stats.topSpeed[1]) this.stats.topSpeed = [p.id, Math.round(b.speed)];
    this.events.push({ type: 'deflect', by: p.id, to: to.id, n: b.n, speed: b.speed, lead: this.t - p.def.winStart });
  }

  /** A clash is a back and forth between two players, each deflect within CLASH_GAP of the one before. */
  noteClash(p) {
    const c = this.clash;
    if (c.n === 0 || this.t - c.lastT > CLASH_GAP) c.n = 1;
    else if (c.n === 1) c.n = 2;
    else if (p.id === c.prev) c.n++;
    else c.n = 1;
    c.prev = c.last;
    c.last = p.id;
    c.lastT = this.t;
    if (c.n > this.stats.bestClash[1]) this.stats.bestClash = [p.id, c.n];
  }

  /** The clash count now (0 once the gap has passed). */
  clashNow() {
    return this.clash.n >= 2 && this.t - this.clash.lastT <= CLASH_GAP ? this.clash.n : 0;
  }

  eliminate(p, why) {
    if (!p.alive) return;
    const b = this.ball;
    p.alive = false;
    p.outAt = this.t;
    this.outs.push(p.id);
    this.events.push({ type: 'out', id: p.id, why, x: p.body.x, y: p.body.y, z: p.body.z });
    const c = this.clash;
    if (why === 'hit' && c.n >= CLASH_KING && p.id === c.prev && c.last && this.players.get(c.last)?.alive) {
      this.events.push({ type: 'clashWon', id: c.last, n: c.n });
    }
    if (b.target === p.id || why === 'hit') c.n = 0;
    if (this.aliveCount() <= 1) {
      this.finish();
      return;
    }
    if (b.active && b.target === p.id) {
      b.pend = 2;
      b.hold = HOLD_S;
      b.pendT = 0;
      b.target = null;
    }
  }

  finish() {
    if (this.phase === 'done') return;
    this.phase = 'done';
    const alive = this.alivePlayers();
    this.winner = alive.length ? alive[0].id : (this.outs[this.outs.length - 1] ?? null);
    this.ball.active = false;
    this.events.push({ type: 'done', winner: this.winner });
  }

  /** Hand over what happened since the last call. */
  drain() {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Best to worst. */
  order() {
    return placementOrder(this.winner, this.outs, this.roster);
  }

  deflectCounts() {
    const d = {};
    for (const p of this.list) if (p.deflects > 0) d[p.id] = p.deflects;
    return d;
  }

  /** Take over a round that was already running (a new host): outs, deflects and, if there was one, the ball. */
  resume({ t, outs = [], deflects = {}, ball = null, bots = null }) {
    this.t = t;
    for (const id of outs) {
      const p = this.players.get(id);
      if (p && p.alive) {
        p.alive = false;
        this.outs.push(id);
      }
    }
    for (const [id, n] of Object.entries(deflects)) {
      const p = this.players.get(id);
      if (p) p.deflects = n;
    }
    if (bots) {
      for (const [id, s] of Object.entries(bots)) {
        const p = this.players.get(id);
        if (p && p.bot && p.alive) {
          p.body.x = s.x;
          p.body.y = s.y;
          p.body.z = s.z;
          p.body.yaw = s.yaw;
        }
      }
    }
    if (this.aliveCount() <= 1) {
      this.finish();
      return;
    }
    if (t >= this.introS) {
      this.phase = 'play';
      const b = this.ball;
      if (ball && this.players.get(ball.target)?.alive) {
        Object.assign(b, ball);
        b.active = true;
        b.px = b.x;
        b.py = b.y;
        b.pz = b.z;
        b.age = Math.max(0, t - this.introS);
      } else {
        b.active = true;
        b.x = b.px = 0;
        b.y = b.py = 1.6;
        b.z = b.pz = 0;
        b.age = Math.max(0, t - this.introS);
        b.speed = ball?.speed ?? this.speedStart;
        b.n = ball?.n ?? 0;
        this.retarget();
      }
    }
  }
}
