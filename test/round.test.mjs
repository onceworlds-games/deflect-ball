import test from 'node:test';
import assert from 'node:assert/strict';
import { STEP, GRACE, SUDDEN_DEATH_S, HIT_R, CHEST, FALL_Y, CLASH_GAP, HOLD_S, INTRO_S, SPEED_START } from '../src/config.js';
import { Round } from '../src/round.js';
import { spawnSlots, placementOrder } from '../src/match.js';

const roster = (n, humans = 0) => Array.from({ length: n }, (_, i) => ({ id: i < humans ? `h${i + 1}` : `bot${i + 1}`, bot: i >= humans }));
const make = (n, humans, o = {}) => new Round({ rid: 'm.1', roster: roster(n, humans), slots: spawnSlots(n, 'm.1'), seed: 5, ...o });
const run = (r, secs) => {
  for (let t = 0; t < secs && !r.over; t += STEP) r.step(STEP);
};
const toPlay = (r) => run(r, INTRO_S + 0.05);
const events = (r, type) => r.drain().filter((e) => e.type === type);

test('players start on the ring facing the centre; the ball appears at the centre after the intro and picks someone', () => {
  const r = make(8, 1);
  assert.equal(r.phase, 'intro');
  for (const p of r.list) {
    assert.ok(Math.abs(Math.hypot(p.body.x, p.body.z) - 18) < 0.05);
    const fx = Math.sin(p.body.yaw);
    const fz = Math.cos(p.body.yaw);
    assert.ok(fx * -p.body.x + fz * -p.body.z > 17.5, 'faces the centre');
  }
  run(r, INTRO_S - 0.1);
  assert.ok(!r.ball.active);
  run(r, 0.2);
  assert.equal(r.phase, 'play');
  assert.ok(r.ball.active);
  assert.ok(Math.abs(r.ball.speed - SPEED_START) < 1);
  assert.ok(r.players.has(r.ball.target) && r.players.get(r.ball.target).alive);
  assert.equal(events(r, 'play').length, 1);
});

test('a judged player deflects inside the window, and the ball goes to someone else, faster', () => {
  const r = make(4, 0);
  toPlay(r);
  r.drain();
  const first = r.players.get(r.ball.target);
  first.judged = true;
  first.bot = false; // we press for it
  let deflected = null;
  for (let i = 0; i < 60 * 20 && !deflected; i++) {
    const b = r.ball;
    const d = Math.hypot(b.x - first.body.x, b.y - (first.body.y + CHEST), b.z - first.body.z);
    if ((d - HIT_R) / b.speed < 0.1) r.press(first.id);
    r.step(STEP);
    deflected = r.drain().find((e) => e.type === 'deflect' && e.by === first.id);
  }
  assert.ok(deflected, 'it deflected');
  assert.notEqual(deflected.to, first.id);
  assert.ok(r.players.get(deflected.to).alive);
  assert.equal(r.ball.n, 1);
  assert.ok(r.ball.speed > SPEED_START);
  assert.equal(first.deflects, 1);
  assert.ok(first.alive);
});

test('no deflect, no life: a judged player the ball reaches is out, and the ball waits a moment before it goes on', () => {
  const r = make(4, 4);
  for (const p of r.list) p.judged = true; // nobody ever presses
  toPlay(r);
  r.drain();
  run(r, 20);
  const outs = r.drain().filter((e) => e.type === 'out');
  assert.ok(outs.length >= 1, 'somebody went out');
  assert.equal(outs[0].why, 'hit');
  assert.ok(r.ball.pend === 2 || r.over || r.ball.target !== outs[0].id);
});

test('too early is wasted: pressing long before the ball arrives does not save you', () => {
  const r = make(3, 3);
  for (const p of r.list) p.judged = true;
  toPlay(r);
  const target = r.players.get(r.ball.target);
  r.press(target.id); // the instant the ball appears: 18 u away at 20 u/s, the window is over long before
  let out = null;
  for (let i = 0; i < 60 * 10 && !out; i++) {
    r.step(STEP);
    out = r.drain().find((e) => e.type === 'out');
  }
  assert.equal(out?.id, target.id);
});

test('a person on another page: the ball waits for their deflect, then goes on; without it they are out after the grace', () => {
  for (const sendIt of [true, false]) {
    const r = make(4, 2);
    r.setJudged('h1', false);
    r.setJudged('h2', false);
    toPlay(r);
    // make h1 the target and run until the ball reaches them
    const h1 = r.players.get('h1');
    r.ball.target = 'h1';
    let steps = 0;
    while (r.ball.pend !== 1 && steps++ < 60 * 20) r.step(STEP);
    assert.equal(r.ball.pend, 1, 'the ball is waiting on h1');
    assert.ok(h1.alive);
    const n = r.ball.n;
    if (sendIt) {
      run(r, GRACE / 2);
      assert.ok(r.humanDeflect('h1', { n, to: 'bot3' }), 'accepted inside the grace');
      assert.equal(r.ball.target, 'bot3');
      assert.equal(r.ball.n, n + 1);
      assert.ok(h1.alive);
      assert.ok(!r.humanDeflect('h1', { n, to: 'bot3' }), 'the same deflect twice is refused');
    } else {
      run(r, GRACE + 0.05);
      assert.ok(!h1.alive, 'out after the grace');
      assert.ok(!r.humanDeflect('h1', { n, to: 'bot3' }), 'too late');
    }
  }
});

test('human deflects are checked: wrong ball, wrong target, far away, bots, the dead', () => {
  const r = make(5, 2);
  r.setJudged('h1', false);
  r.setJudged('h2', false);
  toPlay(r);
  const tgt = r.ball.target;
  const other = r.list.find((p) => !p.bot && p.id !== tgt) ?? r.list.find((p) => p.id !== tgt);
  assert.ok(!r.humanDeflect(other.id, { n: r.ball.n, to: 'bot3' }), 'not the target');
  const t = r.players.get(tgt);
  if (!t.bot) {
    assert.ok(!r.humanDeflect(tgt, { n: 99, to: 'bot3' }), 'wrong n');
    assert.ok(!r.humanDeflect(tgt, { n: r.ball.n, to: 'bot3' }), 'the ball is 18 u away at the start: far too early');
  }
  assert.ok(!r.humanDeflect('bot4', { n: 0 }), 'bots are judged by the host');
  assert.ok(!r.humanDeflect('nobody', { n: 0 }));
  assert.ok(!r.humanDeflect(tgt, null));
});

test('falling off is out, and the ball moves on; the round ends when one is left', () => {
  const r = make(3, 3);
  toPlay(r);
  r.drain();
  r.setPos('h2', 40, -20, 0, 0);
  r.step(STEP);
  let ev = r.drain();
  assert.ok(ev.some((e) => e.type === 'out' && e.id === 'h2' && e.why === 'fall'));
  r.setPos('h3', 0, FALL_Y - 1, 0, 0);
  r.step(STEP);
  ev = r.drain();
  assert.ok(ev.some((e) => e.type === 'out' && e.id === 'h3'));
  assert.ok(r.over);
  assert.equal(r.winner, 'h1');
  assert.deepEqual(r.order(), ['h1', 'h3', 'h2']);
  assert.ok(ev.some((e) => e.type === 'done' && e.winner === 'h1'));
});

test('placements: winner first, then last out first', () => {
  assert.deepEqual(placementOrder('c', ['a', 'd', 'b'], roster(4).map((x, i) => ({ id: 'abcd'[i] }))), ['c', 'b', 'd', 'a']);
  // everyone gone at once: the last one out wins
  assert.deepEqual(placementOrder('b', ['a', 'b'], [{ id: 'a' }, { id: 'b' }]), ['b', 'a']);
});

test('after an elimination the ball holds still, then goes for someone who is alive', () => {
  const r = make(5, 5);
  for (const p of r.list) p.judged = true;
  toPlay(r);
  r.drain();
  let out = null;
  for (let i = 0; i < 60 * 30 && !out; i++) {
    r.step(STEP);
    out = r.drain().find((e) => e.type === 'out');
  }
  assert.ok(out);
  assert.equal(r.ball.pend, 2);
  const at = { x: r.ball.x, z: r.ball.z };
  run(r, HOLD_S / 2);
  assert.equal(r.ball.x, at.x, 'held');
  run(r, HOLD_S);
  assert.equal(r.ball.pend, 0);
  assert.ok(r.players.get(r.ball.target).alive);
  assert.notEqual(r.ball.target, out.id);
});

test('a clash counts deflects within 0.6 s of each other between two players, and breaks when the gap is long', () => {
  const r = make(3, 0);
  const a = r.list[0];
  const b = r.list[1];
  const hit = (p, dt) => {
    r.t += dt;
    r.noteClash(p);
  };
  hit(a, 0);
  assert.equal(r.clash.n, 1);
  hit(b, 0.3);
  assert.equal(r.clash.n, 2);
  hit(a, 0.3);
  assert.equal(r.clash.n, 3);
  hit(b, 0.3);
  assert.equal(r.clash.n, 4);
  assert.equal(r.clashNow(), 4);
  r.t += CLASH_GAP + 0.1;
  assert.equal(r.clashNow(), 0, 'it fades');
  hit(a, 0);
  assert.equal(r.clash.n, 1, 'a long gap starts over');
  // a third player breaks the pair
  hit(b, 0.2);
  hit(r.list[2], 0.2);
  assert.equal(r.clash.n, 1);
  assert.ok(r.stats.bestClash[1] >= 4);
});

test('winning a clash of ten or more is reported when the other player goes out', () => {
  const r = make(3, 3);
  toPlay(r);
  r.drain();
  const [a, b] = [r.list[0], r.list[1]];
  for (let i = 0; i < 12; i++) {
    r.t += 0.2;
    r.noteClash(i % 2 ? b : a);
  }
  // the ball was last deflected by `b` (i = 11): `a` is the one it is flying at
  assert.equal(r.clash.last, b.id);
  r.eliminate(a, 'hit');
  const ev = r.drain();
  const won = ev.find((e) => e.type === 'clashWon');
  assert.equal(won?.id, b.id);
  assert.ok(won.n >= 10);
});

test('after the sudden-death time a window saves nobody', () => {
  const r = make(3, 3);
  for (const p of r.list) p.judged = true;
  toPlay(r);
  r.ball.age = SUDDEN_DEATH_S + 1;
  const t = r.players.get(r.ball.target);
  let out = null;
  for (let i = 0; i < 60 * 10 && !out; i++) {
    r.press(t.id);
    r.step(STEP);
    out = r.drain().find((e) => e.type === 'out');
  }
  assert.ok(out);
});

test('a ball always arrives, wherever a player who never moves is standing', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const r = make(2, 2, { seed });
    for (const p of r.list) p.judged = true;
    toPlay(r);
    const t = r.players.get(r.ball.target);
    const a = (seed / 25) * Math.PI * 2;
    t.body.x = Math.cos(a) * (seed % 5) * 4;
    t.body.z = Math.sin(a) * (seed % 5) * 4;
    run(r, 25);
    assert.ok(r.over, `seed ${seed}: it reached them`);
  }
});

test('a new host picks a round up where it was', () => {
  const a = make(6, 0);
  toPlay(a);
  run(a, 8);
  const snap = { ...a.ball };
  const outs = a.outs.slice();
  const b = make(6, 0, { seed: 99 });
  b.resume({ t: a.t, outs, deflects: a.deflectCounts(), ball: { ...snap, active: true }, bots: Object.fromEntries(a.list.map((p) => [p.id, { x: p.body.x, y: p.body.y, z: p.body.z, yaw: p.body.yaw }])) });
  assert.equal(b.phase, a.phase);
  assert.ok(b.ball.active);
  assert.equal(b.ball.n, snap.n);
  assert.equal(b.aliveCount(), a.aliveCount());
  run(b, 60);
  assert.ok(b.over, 'and it finishes');
});
