// The lobby's practice ball: slow, it only ever comes for you and it never eliminates anybody. Pure.
import { CHEST, HIT_R, ARENA_R, PERFECT_S, clamp } from './config.js';
import { makeBall, stepBall, sweptHit, redirectBall, windowOpen, deflectWorked } from './sim.js';

export function makePractice(rng, id = 'me') {
  return { rng, id, ball: makeBall(), wait: 1.2, streak: 0, best: 0, away: 0, events: [], life: 0 };
}

export function resetPractice(P) {
  P.ball.active = false;
  P.wait = 1.2;
  P.streak = 0;
  P.away = 0;
  P.events.length = 0;
}

/**
 * One fixed step. `me`: { x, y, z } (the player's body), `def`: their deflector, `clock`: the clock the deflector uses (seconds).
 * Fills P.events with { type: 'spawn' | 'deflect' | 'miss' | 'gone', ... } for the caller to play and clear.
 */
export function stepPractice(P, me, def, clock, dt) {
  const b = P.ball;
  if (!b.active) {
    P.wait -= dt;
    if (P.wait <= 0) spawn(P, me);
    return;
  }
  P.life += dt;
  if (b.target === 'dummy') {
    // after a deflect it flies off to nowhere in particular
    b.px = b.x;
    b.py = b.y;
    b.pz = b.z;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    P.away -= dt;
    if (P.away <= 0 || Math.hypot(b.x, b.z) > ARENA_R * 2) {
      b.active = false;
      P.wait = 1.1;
      P.events.push({ type: 'gone', x: b.x, y: b.y, z: b.z });
    }
    return;
  }
  const cy = me.y + CHEST;
  stepBall(b, me.x, cy, me.z, dt);
  if (sweptHit(b, me.x, cy, me.z, HIT_R)) {
    if (windowOpen(def, clock)) {
      const lead = clock - def.winStart;
      P.streak++;
      P.best = Math.max(P.best, P.streak);
      // off it goes towards a random spot of the arena
      const a = P.rng() * Math.PI * 2;
      const r = 6 + P.rng() * 16;
      b.target = 'dummy';
      b.by = P.id;
      redirectBall(b, Math.cos(a) * r, 3, Math.sin(a) * r);
      b.speed = clamp(b.speed + 3, 0, 44);
      const sp = Math.hypot(b.vx, b.vy, b.vz) || 1;
      b.vx = (b.vx / sp) * b.speed;
      b.vy = (b.vy / sp) * b.speed;
      b.vz = (b.vz / sp) * b.speed;
      P.away = 1.6;
      deflectWorked(def, clock);
      P.events.push({ type: 'deflect', x: b.x, y: b.y, z: b.z, streak: P.streak, perfect: lead <= PERFECT_S, speed: b.speed });
    } else {
      P.streak = 0;
      b.active = false;
      P.wait = 1.4;
      P.events.push({ type: 'miss', x: b.x, y: b.y, z: b.z });
    }
  } else if (P.life > 9) {
    b.active = false;
    P.wait = 0.8;
    P.events.push({ type: 'gone', x: b.x, y: b.y, z: b.z });
  }
}

function spawn(P, me) {
  const b = P.ball;
  // a spot 15-19 away that is over the disc
  let x = 0;
  let z = 0;
  for (let i = 0; i < 12; i++) {
    const a = P.rng() * Math.PI * 2;
    const d = 15 + P.rng() * 4;
    x = me.x + Math.cos(a) * d;
    z = me.z + Math.sin(a) * d;
    if (Math.hypot(x, z) < ARENA_R - 3) break;
    x = x * 0.5;
    z = z * 0.5;
  }
  b.active = true;
  b.x = b.px = x;
  b.y = b.py = 4;
  b.z = b.pz = z;
  b.speed = 15 + Math.min(P.streak, 8) * 1.8;
  b.n = 0;
  b.lock++;
  b.target = P.id;
  b.by = null;
  b.pend = 0;
  b.hold = 0;
  b.age = 0;
  const dx = me.x - x;
  const dy = me.y + CHEST - b.y;
  const dz = me.z - z;
  const l = Math.hypot(dx, dy, dz) || 1;
  b.vx = (dx / l) * b.speed;
  b.vy = (dy / l) * b.speed;
  b.vz = (dz / l) * b.speed;
  P.life = 0;
  P.events.push({ type: 'spawn', x, y: b.y, z });
}
