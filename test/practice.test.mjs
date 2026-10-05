import test from 'node:test';
import assert from 'node:assert/strict';
import { STEP, ARENA_R, INTRO_S } from '../src/config.js';
import { mulberry32 } from '../src/rng.js';
import { makePractice, stepPractice } from '../src/practice.js';
import { makeDeflector, pressDeflect, makeBall } from '../src/sim.js';

const me = { x: 0, y: 0, z: 0 };

test('the lobby ball is slow, only comes for you, and a miss costs nothing', () => {
  const P = makePractice(mulberry32(1), 'me');
  const def = makeDeflector();
  let clock = 0;
  let spawned = 0;
  let missed = 0;
  let fastest = 0;
  for (let i = 0; i < 60 * 40; i++) {
    clock += STEP;
    stepPractice(P, me, def, clock, STEP);
    if (P.ball.active) fastest = Math.max(fastest, P.ball.speed);
    for (const e of P.events) {
      if (e.type === 'spawn') {
        spawned++;
        assert.ok(Math.hypot(e.x, e.z) < ARENA_R);
        assert.equal(P.ball.target, 'me');
      }
      if (e.type === 'miss') missed++;
    }
    P.events.length = 0;
  }
  assert.ok(spawned >= 8 && missed >= 8, `it keeps coming (${spawned} balls, ${missed} misses)`);
  assert.ok(fastest < 30);
  assert.equal(P.streak, 0);
});

test('deflecting it in time sends it away and builds a streak; a perfect press is noticed', () => {
  const P = makePractice(mulberry32(2), 'me');
  const def = makeDeflector();
  let clock = 0;
  let deflects = 0;
  let perfect = 0;
  for (let i = 0; i < 60 * 60 && deflects < 6; i++) {
    clock += STEP;
    if (P.ball.active && P.ball.target === 'me') {
      const d = Math.hypot(P.ball.x - me.x, P.ball.y - 1.1, P.ball.z - me.z);
      if ((d - 1.6) / P.ball.speed < 0.08) pressDeflect(def, clock);
    }
    stepPractice(P, me, def, clock, STEP);
    for (const e of P.events) {
      if (e.type === 'deflect') {
        deflects++;
        if (e.perfect) perfect++;
        assert.equal(e.streak, deflects);
      }
    }
    P.events.length = 0;
  }
  assert.equal(deflects, 6);
  assert.ok(perfect >= 1);
  assert.equal(P.best, 6);
  void makeBall;
  void INTRO_S;
});
