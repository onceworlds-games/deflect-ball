// The whole page, run in node: the real main.js, hud, input, audio, scene, actors, effects and camera against a stand-in browser
// (no GPU: the renderer accepts every call). It plays a match as a keyboard-and-mouse player and as one who does nothing, and
// fails on anything that throws or on a screen that never appears. This is what stands in for opening the game.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { installDom, installClock } from './dom.mjs';

register('./loader.mjs', import.meta.url);

const errors = [];
const origError = console.error;
console.error = (...a) => {
  errors.push(a.map(String).join(' '));
};
const origWarn = console.warn;
console.warn = (...a) => { if (process.env.SHOW_WARN) origError('WARN', ...a); };

async function bootGame({ search = '', sdk } = {}) {
  errors.length = 0;
  delete globalThis.onceworlds;
  const dom = installDom();
  globalThis.location = { search, href: `http://localhost/${search}` };
  if (sdk) globalThis.onceworlds = sdk;
  const clock = installClock();
  await import(`../src/main.js?run=${Math.random()}`);
  // let the join and the first frames happen
  for (let i = 0; i < 30; i++) {
    await Promise.resolve();
    await new Promise((r) => setImmediate(r));
    clock.frame();
  }
  return { dom, clock };
}

const visible = (dom, id) => !dom.byId.get(id).classList.contains('hidden');

test('the page boots, shows the title with Play, and Play goes to the lobby', async () => {
  const { dom, clock } = await bootGame();
  assert.deepEqual(errors, [], `console errors: ${errors.join('\n')}`);
  assert.ok(visible(dom, 'title'), 'the title shows');
  assert.ok(visible(dom, 'play'), 'with a Play button');
  for (let i = 0; i < 120; i++) clock.frame(); // two seconds of the demo
  dom.byId.get('play').dispatch('click');
  for (let i = 0; i < 60; i++) clock.frame();
  assert.ok(!visible(dom, 'title'), 'Play hides the title');
  assert.ok(visible(dom, 'lobby'), 'the lobby shows');
  assert.equal(dom.byId.get('setVal').textContent, '5', 'rounds as a big value');
  // the host's tap targets change it
  dom.byId.get('setUp').dispatch('click');
  for (let i = 0; i < 3; i++) clock.frame();
  assert.equal(dom.byId.get('setVal').textContent, '7');
  dom.byId.get('setDown').dispatch('click');
  dom.byId.get('setDown').dispatch('click');
  for (let i = 0; i < 3; i++) clock.frame();
  assert.equal(dom.byId.get('setVal').textContent, '3');
  dom.byId.get('setUp').dispatch('click');
  for (let i = 0; i < 3; i++) clock.frame();
  assert.equal(dom.byId.get('setVal').textContent, '5');
  // the practice ball comes for you in the lobby: a miss is a small callout, never an elimination
  let miss = false;
  for (let i = 0; i < 60 * 12 && !miss; i++) {
    clock.frame();
    if (dom.byId.get('callout').textContent.startsWith('MISS')) miss = true;
  }
  assert.ok(miss, 'the lobby ball arrived and was missed');
  assert.ok(!visible(dom, 'top'), 'no match HUD in the lobby');
  assert.deepEqual(errors, [], `console errors: ${errors.join('\n')}`);
  globalThis.__game = { dom, clock };
});

test('a match from the lobby: countdown, rounds, results, back to the lobby (a player who plays)', async () => {
  const { dom, clock } = globalThis.__game;
  const seen = { count: new Set(), banner: new Set(), top: false, board: false, results: false, callouts: new Set(), reticle: false };
  const key = (code, down = true) => globalThis.dispatchWindowEvent(down ? 'keydown' : 'keyup', { code, repeat: false, key: code });
  // the start button of the stand-in room (the platform draws Ready/Start for real)
  dom.byId.get('stubStart').dispatch('click');
  let phaseOver = 0;
  for (let i = 0; i < 60 * 600; i++) {
    // play a little: walk about, deflect now and then, jump, dash
    if (i % 90 === 0) key('KeyW');
    if (i % 90 === 45) key('KeyW', false);
    if (i % 200 === 0) key('KeyD');
    if (i % 200 === 100) key('KeyD', false);
    if (i % 37 === 0) {
      key('KeyF');
      key('KeyF', false);
    }
    if (i % 301 === 0) key('Space');
    if (i % 503 === 0) key('ShiftLeft');
    if (i % 41 === 0) globalThis.dispatchWindowEvent('pointermove', { pointerType: 'mouse', movementX: 7, movementY: -2, pointerId: 1 });
    clock.frame();
    if (i % 10 === 0) {
      const n = dom.byId.get('count').textContent;
      if (n) seen.count.add(n);
      const b = dom.byId.get('bannerBig').textContent;
      if (b) seen.banner.add(b);
      if (visible(dom, 'top')) seen.top = true;
      if (visible(dom, 'board')) seen.board = true;
      if (visible(dom, 'results')) seen.results = true;
      if (visible(dom, 'reticle')) seen.reticle = true;
      const c = dom.byId.get('callout').textContent;
      if (c) seen.callouts.add(c.replace(/[0-9]+/g, '#'));
    }
    if (seen.results && visible(dom, 'lobby') && !visible(dom, 'board') && dom.byId.get('count').textContent !== '') phaseOver++;
    if (seen.results && i > 60 * 40 && dom.byId.get('setVal') && visible(dom, 'lobby') && !visible(dom, 'top')) {
      // back in the lobby after the final round
      if (++phaseOver > 120) break;
    }
  }
  console.log('seen', [...seen.count].join(','), [...seen.banner].slice(0, 6).join('|'), [...seen.callouts].slice(0, 8).join('|'));
  assert.deepEqual(errors, [], `console errors: ${errors.join('\n')}`);
  assert.ok(seen.count.has('3') && seen.count.has('1'), 'a 3-2-1 countdown');
  assert.ok([...seen.banner].some((b) => b.startsWith('ROUND')), 'a round banner');
  assert.ok(seen.top, 'the top bar');
  assert.ok(seen.board, 'a scoreboard between rounds');
  assert.ok(seen.results, 'the results');
  assert.ok(seen.reticle, 'the deflect reticle');
  assert.ok(visible(dom, 'lobby'), 'back in the lobby');
});

/** Play (or don't) a whole match on the stand-in platform. `act(i, key)` is called every frame. */
async function playMatch({ sdk, act, minRounds = 5, seconds = 700 }) {
  const { dom, clock } = await bootGame({ sdk });
  dom.byId.get('play').dispatch('click');
  for (let i = 0; i < 30; i++) clock.frame();
  dom.byId.get('stubStart').dispatch('click');
  const key = (code, down = true) => globalThis.dispatchWindowEvent(down ? 'keydown' : 'keyup', { code, repeat: false, key: code });
  const banners = new Set();
  let results = false;
  let board = false;
  let after = 0;
  for (let i = 0; i < 60 * seconds; i++) {
    act?.(i, key, dom);
    clock.frame();
    if (i % 10 === 0) {
      const b = dom.byId.get('bannerBig').textContent;
      if (b.startsWith('ROUND')) banners.add(b);
      if (visible(dom, 'results')) results = true;
      if (visible(dom, 'board')) board = true;
    }
    if (results && !visible(dom, 'top') && visible(dom, 'lobby') && ++after > 60) break;
  }
  assert.deepEqual(errors, [], `console errors: ${errors.join('\n')}`);
  assert.ok(banners.size >= minRounds, `rounds seen: ${[...banners].join(',')}`);
  assert.ok(results && board, 'a scoreboard and the results');
  return { dom, clock };
}

function sdkWith(mutate) {
  return import('../src/stub.js').then(({ createStub }) => {
    const { ow } = createStub();
    mutate(ow);
    return ow;
  });
}

test('a player who does nothing is out in every round and still sees the match through', async () => {
  await playMatch({ act: () => {} });
});

test('low quality, reduced motion and touch controls', async () => {
  const sdk = await sdkWith((ow) => {
    ow.settings.quality = 'low';
    ow.settings.reducedMotion = true;
    ow.controls.touch = true;
    ow.controls.stick = { x: 0.6, y: -0.8 };
    ow.controls.set = () => {};
  });
  await playMatch({
    sdk,
    act: (i, key) => {
      sdk.controls.stick.x = Math.sin(i / 50);
      sdk.controls.stick.y = Math.cos(i / 70);
      if (i % 23 === 0) {
        key('KeyF');
        key('KeyF', false);
      }
    },
  });
});

test('every store picture draws and reports ready', async () => {
  for (const name of ['cover', 'action', 'win', 'icon', 'badge-first-win', 'badge-perfect', 'badge-clash-king', 'badge-speed-demon']) {
    errors.length = 0;
    delete globalThis.onceworlds;
    const dom = installDom();
    globalThis.location = { search: `?poster=${name}`, href: `http://localhost/?poster=${name}` };
    const clock = installClock();
    await import(`../src/main.js?poster=${name}&run=${Math.random()}`);
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
      await new Promise((r) => setImmediate(r));
      clock.frame();
    }
    assert.deepEqual(errors, [], `${name}: ${errors.join('\n')}`);
    assert.equal(dom.doc.body.dataset.ready, '1', `${name} is on screen`);
    assert.equal(dom.doc.body.dataset.poster, name);
  }
});

test.after(() => {
  console.error = origError;
  console.warn = origWarn;
});
