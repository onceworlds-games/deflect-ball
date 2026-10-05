// A fake platform for the tests: several pages, one room, virtual time, a little network delay. Just enough of the SDK's
// Room for net.js, with the match cycle the real room keeps (lobby, countdown, playing, endMatch).
import { createNet } from '../src/net.js';
import { STEP, ARENA_R } from '../src/config.js';
import { mulberry32 } from '../src/rng.js';

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export class Hub {
  constructor({ latency = 40, seed = 1, rounds = 3, countdown = 3000 } = {}) {
    this.t = 1000;
    this.latency = latency;
    this.rng = mulberry32(seed);
    this.queue = [];
    this.timers = [];
    this.rooms = new Map();
    this.state = {};
    this.host = null;
    this.settings = { rounds };
    this.match = { phase: 'lobby', n: 0, min: 1 };
    this.countdown = countdown;
    this.ended = 0;
    this.errors = [];
  }

  later(ms, fn) {
    this.queue.push({ at: this.t + ms, fn });
  }
  setInterval(fn, ms) {
    const timer = { next: this.t + ms, ms, fn, live: true };
    this.timers.push(timer);
    return timer;
  }
  clearInterval(timer) {
    if (timer) timer.live = false;
  }

  join(id, name = id) {
    const room = new FakeRoom(this, id, name);
    const prev = this.rooms.get(id);
    if (prev) {
      // a reload: the same player comes back with the presence the room kept for them
      prev.connected = false;
      room.me.presence = clone(prev.me.presence);
      this.rooms.delete(id);
    } else {
      for (const other of this.rooms.values()) {
        other.players.set(id, { id, name, presence: null, team: 0 });
        this.later(this.latency, () => other.emit('join', other.players.get(id)));
      }
    }
    for (const other of this.rooms.values()) room.players.set(other.id, { id: other.id, name: other.name, presence: clone(other.me.presence), team: 0 });
    this.rooms.set(id, room);
    if (!this.host) this.host = id;
    room.host = this.host;
    room.state = clone(this.state);
    room.match = clone(this.match);
    return room;
  }

  /** Everyone gets this at once (the room's own events are not delayed per page in the fake). */
  broadcast(fn) {
    for (const room of this.rooms.values()) if (room.connected) fn(room);
  }

  begin(participants) {
    this.match = {
      phase: 'starting', n: this.match.n + 1, min: 1, id: `m${this.match.n + 1}`, seed: 123456 + this.match.n, participants: participants.slice(),
      startsAt: this.t + this.countdown,
    };
    this.broadcast((r) => r.applyMatch(clone(this.match)));
    this.later(this.countdown, () => {
      if (this.match.phase !== 'starting') return;
      this.match = { ...this.match, phase: 'playing', startedAt: this.t, pausedMs: 0 };
      delete this.match.startsAt;
      this.broadcast((r) => r.applyMatch(clone(this.match)));
    });
  }

  end() {
    this.ended++;
    this.match = { phase: 'lobby', n: this.match.n, min: 1 };
    this.broadcast((r) => r.applyMatch(clone(this.match)));
  }

  /** The connection of `id` drops: they're away for the others, and not the host any more. */
  drop(id) {
    const room = this.rooms.get(id);
    if (!room) return;
    room.connected = false;
    for (const other of this.rooms.values()) {
      if (other === room) continue;
      const p = other.players.get(id);
      if (p) p.connected = false;
      other.emit('away', p);
    }
    if (this.host === id) {
      const next = [...this.rooms.values()].find((r) => r.connected && r.id !== id);
      if (next) {
        this.host = next.id;
        for (const r of this.rooms.values()) {
          r.host = next.id;
          if (r.connected) r.emit('host', next.id);
        }
      }
    }
    room.emit('disconnect');
  }

  restore(id) {
    const room = this.rooms.get(id);
    if (!room) return;
    room.connected = true;
    room.host = this.host;
    room.state = clone(this.state);
    room.match = clone(this.match);
    for (const other of this.rooms.values()) {
      if (other === room) continue;
      const p = other.players.get(id);
      if (p) delete p.connected;
      other.emit('back', p, false);
      const q = room.players.get(other.id);
      if (q) q.presence = clone(other.me.presence);
    }
    room.emit('reconnect');
  }

  /** Move virtual time forward; pages run their frames on the way. */
  advance(ms, perFrame) {
    const end = this.t + ms;
    const frame = STEP * 1000;
    while (this.t < end) {
      this.t = Math.min(end, this.t + frame);
      // queued deliveries first (in time order)
      this.queue.sort((a, b) => a.at - b.at);
      while (this.queue.length && this.queue[0].at <= this.t) this.queue.shift().fn();
      for (const timer of this.timers) {
        while (timer.live && timer.next <= this.t) {
          timer.next += timer.ms;
          try {
            timer.fn();
          } catch (err) {
            this.errors.push(err);
          }
        }
      }
      perFrame?.(this);
    }
  }
}

export class FakeRoom {
  constructor(hub, id, name) {
    this.hub = hub;
    this.id = id;
    this.name = name;
    this.me = { id, name, presence: null, team: 0 };
    this.players = new Map([[id, this.me]]);
    this.connected = true;
    this.host = null;
    this.state = {};
    this.match = { phase: 'lobby', n: 0, min: 1 };
    this.listeners = new Map();
    this.budget = { messagesPerSecond: 40, presenceHz: 20, bytesPerSecond: 100000 };
    this.endCalls = 0;
  }
  get settings() {
    return this.hub.settings;
  }
  get isHost() {
    return this.connected && this.host === this.id;
  }
  get online() {
    return [...this.players.values()].filter((p) => p.connected !== false);
  }
  get participants() {
    if (this.match.phase === 'lobby' || !this.match.participants) return [];
    return this.match.participants.map((id) => this.players.get(id)).filter(Boolean);
  }
  isParticipant(id = this.id) {
    return this.match.phase !== 'lobby' && !!this.match.participants?.includes(id);
  }
  get spectating() {
    return this.match.phase !== 'lobby' && !this.isParticipant();
  }
  get running() {
    return this.match.phase === 'playing' && !this.match.paused;
  }
  matchNow() {
    if (this.match.phase !== 'playing') return 0;
    return Math.max(0, this.hub.t - this.match.startedAt);
  }
  on(event, fn) {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }
  emit(event, ...args) {
    for (const fn of this.listeners.get(event) ?? []) {
      try {
        fn(...args);
      } catch (err) {
        this.hub.errors.push(err);
      }
    }
  }
  applyMatch(next) {
    const previous = this.match;
    this.match = next;
    this.emit('match', next, previous);
    if (previous.phase !== 'starting' && next.phase === 'starting') this.emit('starting', next);
    if (previous.phase !== 'playing' && next.phase === 'playing') this.emit('matchstart', next);
    if (previous.phase !== 'lobby' && next.phase === 'lobby') this.emit('matchend', next, previous);
  }
  setState(key, value) {
    if (!this.connected) return;
    if (value === null || value === undefined) delete this.state[key];
    else this.state[key] = value;
    const v = clone(value);
    this.hub.later(this.hub.latency, () => {
      if (v === null || v === undefined) delete this.hub.state[key];
      else this.hub.state[key] = v;
      for (const r of this.hub.rooms.values()) {
        if (r === this || !r.connected) continue;
        if (v === null || v === undefined) delete r.state[key];
        else r.state[key] = clone(v);
        r.emit('state', key, clone(v), this.id);
      }
    });
  }
  setPresence(data) {
    if (!this.connected) return;
    this.me.presence = data;
    const d = clone(data);
    this.hub.later(this.hub.latency, () => {
      for (const r of this.hub.rooms.values()) {
        if (r === this || !r.connected) continue;
        const p = r.players.get(this.id);
        if (p) p.presence = clone(d);
        r.emit('presence', p);
      }
    });
  }
  presenceAt(id) {
    if (id === this.id) return this.me.presence;
    return this.players.get(id)?.presence ?? null;
  }
  send(data, options = {}) {
    if (!this.connected) return;
    const d = clone(data);
    const mt = this.matchNow();
    this.hub.later(this.hub.latency, () => {
      const deliver = (r) => {
        if (r === this || !r.connected) return;
        r.emit('message', clone(d), r.players.get(this.id) ?? { id: this.id }, this.hub.t, mt);
      };
      if (options.to) {
        const r = this.hub.rooms.get(options.to);
        if (r) deliver(r);
      } else for (const r of this.hub.rooms.values()) deliver(r);
    });
  }
  endMatch() {
    this.endCalls++;
    if (!this.isHost || this.match.phase === 'lobby') return;
    this.hub.end();
  }
  setReady() {}
  clearReady() {}
  hideLobby() {}
  setSetting() {}
}

/** A person at a keyboard, roughly: wanders, aims at someone, presses Deflect when the ball is about to arrive. */
export class Player {
  constructor(hub, id, { skill = 0.85, idle = false, seed = 5, name = id } = {}) {
    this.hub = hub;
    this.id = id;
    this.room = hub.join(id, name);
    this.skill = skill;
    this.idle = idle;
    this.rng = mulberry32(seed);
    this.net = createNet(this.room, { clock: () => hub.t, setTimer: (fn, ms) => hub.setInterval(fn, ms), clearTimer: (t) => hub.clearInterval(t) });
    this.net.setActive(true);
    this.events = [];
    for (const type of ['round', 'play', 'deflect', 'out', 'over', 'final', 'phase', 'mydeflect', 'myimpact', 'clash', 'clashwon', 'press']) {
      this.net.on(type, (d) => this.events.push({ type, ...d, at: hub.t }));
    }
    this.wander = this.rng() * Math.PI * 2;
    this.planN = -1;
    this.pressAt = 0;
    this.spot = { x: 0, z: 0 };
    this.aimT = 0;
    this.frames = 0;
  }

  /** What the page does in one rendered frame. */
  frame() {
    const net = this.net;
    this.frames++;
    const b = net.body;
    let input = { mx: 0, mz: 0, aim: net.aim };
    if (b && !this.idle) {
      this.wander += (this.rng() - 0.5) * 0.1;
      let mx = Math.cos(this.wander) * 0.6;
      let mz = Math.sin(this.wander) * 0.6;
      const r = Math.hypot(b.x, b.z);
      if (r > 18) {
        mx = -b.x / r;
        mz = -b.z / r;
      }
      input = { mx, mz, aim: this.aimYaw(), face: Math.atan2(mx, mz) };
    }
    const ph = net.phase;
    if (!this.idle && ph === 'play' && net.alive) {
      const ball = net.ballView();
      if (ball.active && ball.target === this.id && !ball.pend && b) {
        const d = Math.hypot(ball.x - b.x, ball.y - (b.y + 1.1), ball.z - b.z);
        const tti = Math.max(0, d - 1.6) / Math.max(1, ball.speed);
        if (this.planN !== ball.n + ':' + ball.target) {
          this.planN = ball.n + ':' + ball.target;
          this.pressAt = 0.1 + (this.rng() - 0.5) * 0.16 * (1.5 - this.skill) + (ball.speed / 400) * (this.rng() - 0.3);
          this.pressed = false;
        }
        if (!this.pressed && tti <= this.pressAt) {
          this.pressed = true;
          net.press();
        }
      }
    }
    net.step(STEP, input);
    net.frame(STEP);
  }

  aimYaw() {
    const net = this.net;
    this.aimT--;
    if (this.aimT > 0 && this.lastAim !== undefined) return this.lastAim;
    this.aimT = 60;
    const others = net.roster.filter((r) => r.id !== this.id && !net.isOut(r.id));
    const b = net.body;
    if (!others.length || !b) return this.lastAim ?? 0;
    const pick = others[Math.floor(this.rng() * others.length)];
    const p = net.pose(pick.id, {});
    this.lastAim = p ? Math.atan2(p.x - b.x, p.z - b.z) : 0;
    return this.lastAim;
  }
}

/** Run a whole match (a hub, some players) until the lobby is back; returns what was observed. */
export function runMatch({ humans = [], seed = 1, rounds = 3, maxSeconds = 1200, before, perSecond }) {
  const hub = new Hub({ seed, rounds });
  const players = humans.map((h, i) => new Player(hub, h.id, { seed: seed * 31 + i, ...h }));
  before?.(hub, players);
  hub.begin(players.map((p) => p.id));
  const startEnded = hub.ended;
  let seconds = 0;
  while (hub.ended === startEnded && seconds < maxSeconds) {
    hub.advance(1000, () => {
      for (const p of players) if (p.room.connected || p.alwaysFrame) p.frame();
    });
    seconds++;
    perSecond?.(hub, players, seconds);
  }
  return { hub, players, seconds, finished: hub.ended > startEnded };
}

export { ARENA_R };
