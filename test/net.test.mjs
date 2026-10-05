// Several pages against one fake room (virtual time, a little delay): the host's rules, a client's own deflects, a host that
// drops, a page that reloads, a latecomer, people who do nothing and messages that make no sense.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hub, Player, runMatch } from './fakeroom.mjs';
import { FALL_Y } from '../src/config.js';

const count = (p, type, f = () => true) => p.events.filter((e) => e.type === type && f(e)).length;
const noErrors = (hub) => assert.deepEqual(hub.errors.map(String), []);

test('one person and seven bots: three rounds, results, and the host ends the match', () => {
  const { hub, players, finished } = runMatch({ humans: [{ id: 'ann' }], seed: 3, rounds: 3 });
  assert.ok(finished, 'the match ended by itself');
  noErrors(hub);
  assert.equal(hub.ended, 1);
  const ann = players[0];
  assert.equal(count(ann, 'round'), 3);
  assert.equal(count(ann, 'play'), 3);
  assert.equal(count(ann, 'over'), 3);
  assert.equal(count(ann, 'final'), 1);
  const fin = ann.events.find((e) => e.type === 'final').g;
  assert.equal(fin.roster.length, 8);
  assert.equal(fin.fr.length, 8);
  assert.equal(new Set(fin.fr).size, 8);
  assert.equal(fin.n, 3);
  for (const id of fin.fr) assert.ok(Number.isFinite(fin.scores[id]));
  assert.ok(count(ann, 'deflect') > 10, 'the ball was deflected');
  assert.ok(count(ann, 'out') >= 3 * 5, 'players went out');
  assert.equal(ann.net.phase, 'lobby', 'back in the lobby');
});

test('three people, one of them away from the keyboard, and the host drops in round two', () => {
  let dropped = false;
  const { hub, players, finished } = runMatch({
    humans: [{ id: 'ann' }, { id: 'bob', skill: 0.5 }, { id: 'cy', idle: true }],
    seed: 9,
    rounds: 3,
    perSecond: (h, ps) => {
      const g = ps[1].room.state.g;
      if (!dropped && g?.n === 2 && g?.phase === 'play') {
        dropped = true;
        assert.equal(h.host, 'ann');
        h.drop('ann');
      }
    },
  });
  assert.ok(dropped && finished);
  noErrors(hub);
  const [ann, bob, cy] = players;
  assert.equal(count(bob, 'final'), 1);
  assert.equal(count(cy, 'final'), 1);
  assert.equal(count(ann, 'final'), 0, 'the page that dropped never saw the end');
  assert.equal(hub.host, 'bob');
  // the one who does nothing is out in every round
  assert.equal(count(bob, 'out', (e) => e.id === 'cy'), 3);
  const g = bob.room.state.g;
  assert.equal(g.by, 'bob', 'the new host wrote the rest');
  assert.equal(new Set(g.fr).size, 8);
  // people's deflects reached the host: bob is a client at first, then the host
  assert.ok(count(bob, 'mydeflect') > 0);
});

test('two competent people: each decides their own deflect and the host honours it', () => {
  const { hub, players, finished } = runMatch({ humans: [{ id: 'ann' }, { id: 'bob' }], seed: 21, rounds: 3 });
  assert.ok(finished);
  noErrors(hub);
  const bob = players[1]; // a client the whole way
  assert.ok(count(bob, 'mydeflect') > 3, `bob deflected ${count(bob, 'mydeflect')} times himself`);
  const g = players[0].events.find((e) => e.type === 'final').g;
  assert.ok((g.tot.bob ?? 0) > 0, 'and the host counted them');
  assert.ok((g.scores.bob ?? 0) > 0);
});

test('a page that reloads in the middle of a round comes back to the same place and the match goes on', () => {
  let reloaded = null;
  let bobBefore = null;
  const { hub, finished } = runMatch({
    humans: [{ id: 'ann' }, { id: 'bob' }, { id: 'cy' }],
    seed: 14,
    rounds: 3,
    perSecond: (h, ps, s) => {
      const g = ps[0].room.state.g;
      if (!reloaded && g?.n === 2 && g?.phase === 'play' && s > 60) {
        bobBefore = { alive: ps[1].net.alive, phase: ps[1].net.phase, body: ps[1].net.body && { ...ps[1].net.body } };
        ps[1].net.stop();
        reloaded = new Player(h, 'bob', { seed: 99 });
        ps[1] = reloaded;
      }
    },
  });
  assert.ok(reloaded && finished);
  noErrors(hub);
  assert.equal(reloaded.net.phase, 'lobby');
  assert.equal(count(reloaded, 'final'), 1, 'it saw the results');
  assert.ok(bobBefore.phase === 'play');
  // it did not replay the eliminations that had already happened
  assert.ok(count(reloaded, 'out') <= 8 * 2, 'no replay of old eliminations');
});

test('someone who arrives while a match is on watches it and sees the results', () => {
  let late = null;
  let leaked = false;
  const { hub, players, finished } = runMatch({
    humans: [{ id: 'ann' }],
    seed: 5,
    rounds: 3,
    perSecond: (h, ps, s) => {
      if (!late && s === 20) {
        late = new Player(h, 'late', { seed: 4 });
        ps.push(late);
        assert.ok(late.room.spectating);
      }
      if (late && h.match.phase === 'playing' && late.room.me.presence) leaked = true;
    },
  });
  assert.ok(late && finished);
  noErrors(hub);
  assert.equal(late.net.inRoster, false);
  assert.ok(!leaked, 'they put no runner into the match');
  assert.ok(late.events.some((e) => e.type === 'deflect'), 'they watched the ball');
  assert.equal(count(late, 'final'), 1);
  void players;
});

test('messages that make no sense change nothing', () => {
  const { hub, finished } = runMatch({
    humans: [{ id: 'ann' }, { id: 'bob' }],
    seed: 8,
    rounds: 3,
    perSecond: (h, ps, s) => {
      const bob = ps[1];
      if (s > 5 && s % 3 === 0) {
        for (const junk of [null, 5, 'x', {}, { t: 'deflect' }, { t: 'deflect', rid: 'nope', n: 1 }, { t: 'deflect', rid: bob.room.state.g?.rid, n: 'a' }, { t: 'deflect', rid: bob.room.state.g?.rid, n: -4, to: 5 }, { t: 'deflect', rid: bob.room.state.g?.rid, n: 9999, to: 'ann', aim: NaN }]) {
          bob.room.send(junk, { to: h.host });
        }
        bob.room.setState('b', { r: bob.room.state.g?.rid, t: 'x', n: 'y' });
      }
    },
  });
  assert.ok(finished);
  noErrors(hub);
});

test('falling off the arena is out, and the next round starts clean (stale position from the last round is ignored)', () => {
  let pushed = false;
  let pushedRound = 0;
  const { hub, players, finished } = runMatch({
    humans: [{ id: 'ann', idle: true }, { id: 'bob', idle: true }],
    seed: 2,
    rounds: 3,
    perSecond: (h, ps) => {
      const g = ps[1].room.state.g;
      if (!pushed && g?.n === 1 && g?.phase === 'play' && ps[0].net.body) {
        pushed = true;
        pushedRound = 1;
        const b = ps[0].net.body;
        b.y = FALL_Y - 3;
        b.ground = false;
      }
    },
  });
  assert.ok(pushed && finished);
  noErrors(hub);
  const bob = players[1];
  const annOuts = bob.events.filter((e) => e.type === 'out' && e.id === 'ann');
  assert.equal(annOuts.length, 3, 'out in every round: once by falling, then by the ball, and not at the start of the next');
  const round2 = bob.events.find((e) => e.type === 'round' && e.n === 2);
  const firstOutRound2 = annOuts.find((e) => e.at > round2.at);
  assert.ok(firstOutRound2.at - round2.at > 2500, `not eliminated at once on spawning (${firstOutRound2.at - round2.at} ms in)`);
  void pushedRound;
});

test('a player who goes away is judged by the host and never stalls the round', () => {
  let dropped = false;
  const { hub, finished } = runMatch({
    humans: [{ id: 'ann' }, { id: 'bob' }, { id: 'cy' }],
    seed: 6,
    rounds: 3,
    perSecond: (h, ps) => {
      const g = ps[0].room.state.g;
      if (!dropped && g?.n === 1 && g?.phase === 'play') {
        dropped = true;
        h.drop('cy');
      }
    },
  });
  assert.ok(dropped && finished, 'the match ended without cy');
  noErrors(hub);
});

test('the match waits while paused and goes on afterwards', () => {
  const hub = new Hub({ seed: 1, rounds: 3 });
  const ann = new Player(hub, 'ann', { seed: 3 });
  hub.begin(['ann']);
  const run = (secs) => hub.advance(secs * 1000, () => ann.frame());
  run(8);
  const before = ann.room.state.g;
  assert.ok(before && before.phase === 'play');
  const t0 = ann.net.ballView().n;
  // pause: the room stops the match clock; nothing may move
  hub.match = { ...hub.match, paused: { since: hub.t, reason: 'few_players' } };
  ann.room.match = JSON.parse(JSON.stringify(hub.match));
  const ballBefore = { ...ann.net.ballView() };
  run(5);
  const ballAfter = ann.net.ballView();
  assert.equal(ballAfter.x, ballBefore.x);
  assert.equal(ballAfter.n, t0);
  // resume
  const waited = hub.t - hub.match.paused.since;
  hub.match = { ...hub.match, pausedMs: waited };
  delete hub.match.paused;
  ann.room.match = JSON.parse(JSON.stringify(hub.match));
  run(10);
  assert.notEqual(ann.net.ballView().x, ballBefore.x, 'moving again');
  noErrors(hub);
});
