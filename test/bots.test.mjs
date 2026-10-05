import test from 'node:test';
import assert from 'node:assert/strict';
import { STEP, ARENA_R, TABLE } from '../src/config.js';
import { mulberry32 } from '../src/rng.js';
import { makeBrain, think, chooseTo } from '../src/bots.js';
import { makeBody, stepBody, makeBall, pressDeflect, makeDeflector } from '../src/sim.js';
import { Round } from '../src/round.js';
import { buildRoster, spawnSlots } from '../src/match.js';

test('bots make legal moves and stay on the disc for two minutes', () => {
  const rng = mulberry32(3);
  const people = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2;
    return { id: `b${i}`, body: makeBody(Math.cos(a) * 18, Math.sin(a) * 18, 0), brain: makeBrain(rng) };
  });
  const ball = makeBall();
  let worst = 0;
  for (let t = 0; t < 120; t += STEP) {
    const others = people.map((p) => ({ id: p.id, x: p.body.x, z: p.body.z, deflects: 0 }));
    for (const p of people) {
      const inp = think(p.brain, p, { t, ball, others }, STEP, rng);
      for (const k of ['mx', 'mz', 'face']) assert.ok(Number.isFinite(inp[k]), `${k} is a number`);
      assert.ok(Math.hypot(inp.mx, inp.mz) < 6);
      assert.equal(typeof inp.press, 'boolean');
      stepBody(p.body, inp, STEP);
      worst = Math.max(worst, Math.hypot(p.body.x, p.body.z));
      assert.ok(p.body.y > -0.5, 'never falls');
    }
  }
  assert.ok(worst < ARENA_R - 1, `stays well inside: ${worst}`);
});

test('a bot hands a slow ball back almost every time and misses a very fast one often', () => {
  const rate = (speed, trials) => {
    let saved = 0;
    for (let k = 0; k < trials; k++) {
      const rng = mulberry32(k * 7 + 1);
      const brain = makeBrain(rng);
      const me = { id: 'me', body: makeBody(0, 0, 0), def: makeDeflector() };
      const ball = makeBall();
      ball.active = true;
      ball.speed = speed;
      ball.target = 'me';
      ball.lock = 1;
      // a ball that has just been sent from 16 u away
      ball.x = ball.px = 16 * Math.cos(k);
      ball.z = ball.pz = 16 * Math.sin(k);
      ball.y = ball.py = 1.6;
      let hit = false;
      let pressed = false;
      for (let t = 0; t < 4 && !hit; t += STEP) {
        const inp = think(brain, me, { t, ball, others: [] }, STEP, rng);
        if (inp.press) {
          pressed = pressDeflect(me.def, t) || pressed;
        }
        const dx = -ball.x;
        const dz = -ball.z;
        const dy = 1.1 - ball.y;
        const l = Math.hypot(dx, dy, dz);
        ball.px = ball.x; ball.py = ball.y; ball.pz = ball.z;
        ball.x += (dx / l) * speed * STEP;
        ball.y += (dy / l) * speed * STEP;
        ball.z += (dz / l) * speed * STEP;
        ball.vx = (dx / l) * speed; ball.vy = (dy / l) * speed; ball.vz = (dz / l) * speed;
        if (l < 1.6 + speed * STEP) {
          hit = true;
          if (me.def.winUntil >= t && t >= me.def.winStart) saved++;
        }
      }
      void pressed;
    }
    return saved / trials;
  };
  const slow = rate(25, 300);
  assert.ok(slow > 0.95, `slow balls are handled: ${slow}`);
  assert.ok(rate(60, 200) > 0.8, 'medium balls mostly');
  assert.ok(rate(200, 200) < 0.6, 'very fast balls get through');
});

test('who a bot sends the ball to is someone else, and a threat is the round leader', () => {
  const rng = mulberry32(2);
  const brain = makeBrain(rng);
  brain.threat = true;
  assert.equal(chooseTo(brain, [{ id: 'a', deflects: 1 }, { id: 'b', deflects: 4 }, { id: 'c', deflects: 2 }], rng), 'b');
  brain.threat = false;
  const seen = new Set();
  for (let i = 0; i < 60; i++) seen.add(chooseTo(brain, [{ id: 'a' }, { id: 'b' }, { id: 'c' }], rng));
  assert.equal(seen.size, 3);
  assert.equal(chooseTo(brain, [], rng), null);
});

test('bots in a round: nobody falls, nobody steps off, the round ends', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const roster = buildRoster([], seed).map((r) => ({ ...r }));
    assert.equal(roster.length, TABLE);
    const r = new Round({ rid: `t.${seed}`, roster, slots: spawnSlots(roster.length, `t.${seed}`), seed });
    let falls = 0;
    for (let i = 0; i < 60 * 400 && !r.over; i++) {
      r.step(STEP);
      for (const e of r.drain()) if (e.type === 'out' && e.why === 'fall') falls++;
    }
    assert.ok(r.over, `seed ${seed} ended`);
    assert.equal(falls, 0, `seed ${seed}: nobody fell`);
  }
});
