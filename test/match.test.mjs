import test from 'node:test';
import assert from 'node:assert/strict';
import { TABLE, RING_R, BOT_NAMES, PLACE_POINTS, ARENA_R } from '../src/config.js';
import { buildRoster, spawnSlots, lobbySpot, roundGain, addScores, rankMatch, awardsFrom, ordinal, colorOf } from '../src/match.js';
import { playMatch, finite } from './harness.mjs';

test('the roster is the participants, then bots up to eight; same for every page', () => {
  const a = buildRoster(['u1', 'u2'], 77);
  assert.equal(a.length, TABLE);
  assert.deepEqual(a.slice(0, 2).map((r) => r.id), ['u1', 'u2']);
  assert.ok(a.slice(2).every((r, i) => r.bot && r.id === `bot${i + 1}` && BOT_NAMES.includes(r.name)));
  assert.equal(new Set(a.map((r) => r.name).filter(Boolean)).size, 6, 'bot names are different');
  assert.deepEqual(buildRoster(['u1', 'u2'], 77), a, 'deterministic');
  assert.notDeepEqual(buildRoster(['u1', 'u2'], 78).map((r) => r.name), a.map((r) => r.name));
  assert.equal(buildRoster(Array.from({ length: 12 }, (_, i) => `p${i}`), 1).length, 12, 'twelve people, no bots');
  assert.equal(buildRoster(['x', 'x', 'y'], 1).filter((r) => !r.bot).length, 2, 'no one twice');
  assert.equal(buildRoster([], 1).length, TABLE);
  assert.equal(buildRoster(undefined, 1).length, TABLE);
});

test('spawn spots: a ring of radius 18, all different, facing in, and the same on every page', () => {
  const s = spawnSlots(8, 'm1.2');
  assert.equal(s.length, 8);
  for (const p of s) assert.ok(Math.abs(Math.hypot(p.x, p.z) - RING_R) < 0.05);
  const keys = new Set(s.map((p) => `${p.x},${p.z}`));
  assert.equal(keys.size, 8);
  assert.deepEqual(spawnSlots(8, 'm1.2'), s);
  assert.notDeepEqual(spawnSlots(8, 'm1.3'), s);
  assert.equal(spawnSlots(12, 'x').length, 12);
  assert.equal(spawnSlots(0, 'x').length, 1);
  const l = lobbySpot('someone');
  assert.ok(Math.hypot(l.x, l.z) < ARENA_R - 5);
});

test('points: 5, 3, 2, 1 for the first four places, plus a point per deflect up to five', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];
  const g = roundGain(order, { a: 2, b: 9, e: 1 });
  assert.equal(g.a, PLACE_POINTS[0] + 2);
  assert.equal(g.b, PLACE_POINTS[1] + 5);
  assert.equal(g.c, 2);
  assert.equal(g.d, 1);
  assert.equal(g.e, 0 + 1);
  assert.deepEqual(addScores({ a: 1, z: 4 }, { a: 5, b: 3 }), { a: 6, z: 4, b: 3 });
  assert.equal(roundGain(['a'], { a: -4 }).a, 5);
});

test('the final order: points, then deflects, then seat', () => {
  const roster = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  assert.deepEqual(rankMatch(roster, { a: 5, b: 9, c: 9, d: 1 }, { b: 3, c: 7 }), ['c', 'b', 'a', 'd']);
  assert.deepEqual(rankMatch(roster, { a: 3, b: 3, c: 3, d: 3 }, {}), ['a', 'b', 'c', 'd']);
});

test('awards come from what was tallied, and only when somebody earned them', () => {
  const none = awardsFrom({});
  assert.deepEqual(none, { most: null, speed: null, clash: null });
  const a = awardsFrom({ totals: { x: 3, y: 8 }, topSpeed: ['y', 141], bestClash: ['x', 12] });
  assert.deepEqual(a.most, ['y', 8]);
  assert.deepEqual(a.speed, ['y', 141]);
  assert.deepEqual(a.clash, ['x', 12]);
  assert.equal(awardsFrom({ bestClash: ['x', 2] }).clash, null);
});

test('places read as ordinals, colours wrap', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
  assert.equal(colorOf(0), colorOf(12));
  assert.match(colorOf(-1), /^#/);
});

test('whole matches of bots, 20 seeds: every round ends, everyone is ranked, no NaN, nobody leaves the disc', () => {
  let totalSeconds = 0;
  let rounds = 0;
  let maxSpeed = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const rn = [3, 5, 7][seed % 3];
    const m = playMatch({ seed, rounds: rn, humans: seed % 4 });
    assert.deepEqual(m.problems, [], `seed ${seed}: ${m.problems.slice(0, 3).join('; ')}`);
    assert.equal(m.log.length, rn);
    assert.equal(new Set(m.rank).size, m.roster.length, 'everyone is ranked, once');
    assert.deepEqual([...m.rank].sort(), m.roster.map((r) => r.id).sort());
    for (const id of m.rank) assert.ok(finite(m.scores[id]) && m.scores[id] >= 0);
    const best = m.scores[m.rank[0]];
    assert.ok(m.rank.every((id) => m.scores[id] <= best));
    for (const r of m.log) {
      assert.equal(r.order.length, m.roster.length, 'a placing for everyone');
      assert.equal(r.order[0], r.winner);
      assert.ok(r.worstRadius <= ARENA_R, `seed ${seed} round ${r.n}: alive players stay on the disc (${r.worstRadius})`);
      assert.ok(r.seconds > 5 && r.seconds < 400, `round of ${r.seconds}s`);
      totalSeconds += r.seconds;
      rounds++;
      maxSpeed = Math.max(maxSpeed, r.maxSpeed);
    }
    // the points add up
    const gained = m.log.reduce((s, r) => s + Object.values(r.gain).reduce((a, b) => a + b, 0), 0);
    assert.equal(Object.values(m.scores).reduce((a, b) => a + b, 0), gained);
  }
  const avg = totalSeconds / rounds;
  console.log(`  ${rounds} rounds, ${avg.toFixed(0)} s on average, fastest ball ${maxSpeed.toFixed(0)} u/s`);
  assert.ok(avg > 20 && avg < 120, 'rounds are a minute or so');
});
