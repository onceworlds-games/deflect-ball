import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STEP, ARENA_R, FALL_Y, MOVE_SPEED, JUMP_V, GRAVITY, DASH_SPEED, DASH_TIME, DASH_CD, WINDOW, DEFLECT_CD, HIT_R, CHEST, SPEED_MAX, CONE_HALF,
} from '../src/config.js';
import {
  makeBody, stepBody, fellOut, makeBall, stepBall, sweptHit, redirectBall, aimBall, makeDeflector, pressDeflect, windowOpen, deflectWorked,
  pickTarget, wrapAngle, onArena, rampAt, turnRate,
} from '../src/sim.js';

const run = (b, input, secs) => {
  for (let t = 0; t < secs; t += STEP) stepBody(b, typeof input === 'function' ? input(t) : input, STEP);
  return b;
};

test('a body walks at move speed and stops when let go', () => {
  const b = makeBody(0, 0, 0);
  run(b, { mx: 1, mz: 0 }, 1);
  assert.ok(Math.abs(b.speed - MOVE_SPEED) < 0.3, `speed ${b.speed}`);
  assert.ok(b.x > 7 && b.x < 9.5, `x ${b.x}`);
  run(b, { mx: 0, mz: 0 }, 0.6);
  assert.equal(b.speed, 0);
});

test('diagonal movement is not faster, analog movement is slower', () => {
  const d = run(makeBody(), { mx: 1, mz: 1 }, 1);
  assert.ok(d.speed <= MOVE_SPEED + 0.3);
  const a = run(makeBody(), { mx: 0.5, mz: 0 }, 1);
  assert.ok(a.speed < MOVE_SPEED * 0.6);
});

test('a jump rises about v^2/2g and lands back on the floor', () => {
  const b = makeBody();
  stepBody(b, { jump: true }, STEP);
  let apex = 0;
  let steps = 0;
  while (!b.ground && steps++ < 600) {
    stepBody(b, {}, STEP);
    apex = Math.max(apex, b.y);
  }
  assert.ok(b.ground && b.y === 0);
  const expected = (JUMP_V * JUMP_V) / (2 * GRAVITY);
  assert.ok(Math.abs(apex - expected) < 0.15, `apex ${apex} vs ${expected}`);
});

test('dash is a short burst to 28 u/s with a 4 s cooldown', () => {
  const b = makeBody(0, 0, Math.PI / 2); // facing +x
  stepBody(b, { dash: true }, STEP);
  assert.ok(b.dashed);
  assert.ok(Math.abs(b.vx - DASH_SPEED) < 1e-6);
  run(b, {}, DASH_TIME + 0.02);
  const after = b.x;
  assert.ok(after > 3.5 && after < 7.5, `dash distance ${after}`);
  // cooling down: a second dash is refused
  const x1 = b.x;
  stepBody(b, { dash: true }, STEP);
  assert.ok(!b.dashed);
  run(b, {}, DASH_CD);
  stepBody(b, { dash: true }, STEP);
  assert.ok(b.dashed, 'ready again after the cooldown');
  assert.ok(b.x >= x1);
});

test('walking off the edge falls out; the edge is the arena radius', () => {
  const b = makeBody(ARENA_R - 1, 0, 0);
  let steps = 0;
  while (!fellOut(b) && steps++ < 600) stepBody(b, { mx: 1, mz: 0 }, STEP);
  assert.ok(fellOut(b), 'fell out');
  assert.ok(b.y <= FALL_Y);
  assert.ok(!onArena(ARENA_R + 0.1, 0));
  assert.ok(onArena(ARENA_R - 0.1, 0));
});

test('a body cannot climb back from under the floor', () => {
  const b = makeBody(ARENA_R + 2, 0, 0);
  b.ground = false;
  b.y = -3;
  b.vy = -2;
  for (let i = 0; i < 20; i++) stepBody(b, { mx: -1, mz: 0 }, STEP);
  assert.ok(b.y < -3, 'still falling');
});

test('the ball homes in on a still target and hits it', () => {
  const b = makeBall();
  b.active = true;
  b.speed = 30;
  b.vx = 0;
  b.vz = 30; // flying the wrong way at first
  let hit = false;
  for (let i = 0; i < 60 * 8 && !hit; i++) {
    stepBall(b, 10, CHEST, -4, STEP);
    hit = sweptHit(b, 10, CHEST, -4, HIT_R);
  }
  assert.ok(hit, 'it curves round and arrives');
});

test('a 220 u/s ball never tunnels through a target', () => {
  for (let k = 0; k < 40; k++) {
    const b = makeBall();
    b.active = true;
    b.speed = SPEED_MAX;
    const a = (k / 40) * Math.PI * 2;
    b.x = b.px = Math.cos(a) * 18;
    b.z = b.pz = Math.sin(a) * 18;
    b.y = b.py = 1.6;
    aimBall(b, 0, CHEST, 0);
    let hit = false;
    for (let i = 0; i < 120 && !hit; i++) {
      stepBall(b, 0, CHEST, 0, STEP);
      hit = sweptHit(b, 0, CHEST, 0, HIT_R);
    }
    assert.ok(hit, `angle ${k}`);
  }
});

test('swept test: a miss stays a miss', () => {
  const b = makeBall();
  b.px = 0; b.py = 1; b.pz = 0; b.x = 10; b.y = 1; b.z = 0;
  assert.ok(!sweptHit(b, 5, 1 + HIT_R + 0.5, 0, HIT_R));
  assert.ok(sweptHit(b, 5, 1 + HIT_R - 0.2, 0, HIT_R));
});

test('a deflect adds speed, never beyond the maximum, and counts', () => {
  const b = makeBall();
  b.x = 0; b.y = 1; b.z = 0;
  const s0 = b.speed;
  redirectBall(b, 10, 1, 0);
  assert.ok(b.speed > s0);
  assert.equal(b.n, 1);
  assert.ok(b.vx > 0);
  b.speed = SPEED_MAX;
  redirectBall(b, 10, 1, 0);
  assert.equal(b.speed, SPEED_MAX);
});

test('turn rate and ramp are sane', () => {
  assert.ok(turnRate(20) > 3 && turnRate(220) < 10);
  assert.ok(rampAt(0) > 0 && rampAt(100) > rampAt(0));
});

test('the deflect window: opens on press, lasts 0.25 s, then a 0.9 s cooldown; a success resets it', () => {
  const d = makeDeflector();
  assert.ok(!windowOpen(d, 0));
  assert.ok(pressDeflect(d, 1));
  assert.ok(windowOpen(d, 1.1));
  assert.ok(windowOpen(d, 1 + WINDOW));
  assert.ok(!windowOpen(d, 1 + WINDOW + 0.01));
  assert.ok(!pressDeflect(d, 1 + DEFLECT_CD - 0.01), 'cooling down');
  assert.ok(pressDeflect(d, 1 + DEFLECT_CD));
  // success: closes the window and gives the button back at once
  const e = makeDeflector();
  pressDeflect(e, 5);
  assert.ok(windowOpen(e, 5.1));
  deflectWorked(e, 5.1);
  assert.ok(!windowOpen(e, 5.12));
  assert.ok(pressDeflect(e, 5.12));
});

test('aim picks the player nearest the aim inside the cone, else the nearest', () => {
  const cands = [
    { id: 'a', x: 0, z: 10 }, // straight ahead (yaw 0)
    { id: 'b', x: 10, z: 0 },
    { id: 'c', x: 3, z: 2 }, // close, but off to the side
  ];
  assert.equal(pickTarget(0, 0, 0, cands, 'me'), 'a');
  assert.equal(pickTarget(0, 0, Math.PI / 2, cands, 'me'), 'b');
  // aiming at nobody: the nearest
  assert.equal(pickTarget(0, 0, Math.PI, cands, 'me'), 'c');
  // excluded ids never come back
  assert.equal(pickTarget(0, 0, 0, cands, 'a'), 'c');
  assert.equal(pickTarget(0, 0, 0, [], 'me'), null);
  // exactly on the cone's edge in
  const edge = [{ id: 'e', x: Math.sin(CONE_HALF - 0.01) * 10, z: Math.cos(CONE_HALF - 0.01) * 10 }, { id: 'n', x: 0, z: -3 }];
  assert.equal(pickTarget(0, 0, 0, edge, 'me'), 'e');
});

test('angles wrap', () => {
  assert.ok(Math.abs(wrapAngle(Math.PI * 3) - Math.PI) < 1e-9 || Math.abs(wrapAngle(Math.PI * 3) + Math.PI) < 1e-9);
  assert.ok(Math.abs(wrapAngle(-Math.PI * 2.5) + Math.PI / 2) < 1e-9);
});
