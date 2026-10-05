// The light is set so that the game and its store pictures are not washed out, with or without the bloom pass. These checks keep
// the settings that matter from drifting: one tone mapping for every material (so the plain and the bloom paths look alike), a
// bloom that only touches what is over-bright, and glow that stays the size of the thing that glows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('every material goes through the same tone mapping (only the poster title plane is exempt)', () => {
  for (const f of ['scene.js', 'actors.js', 'fx.js']) assert.ok(!/toneMapped:\s*false/.test(src(f)), `${f} bypasses tone mapping`);
  const poster = src('poster.js').split('\n').filter((l) => /toneMapped:\s*false/.test(l));
  assert.equal(poster.length, 1);
  assert.ok(/PlaneGeometry\(W, H\)/.test(poster[0]), 'only the title plane');
});

test('the bloom is a light touch', () => {
  const m = /UnrealBloomPass\(new THREE\.Vector2\(W, H\), current === 'high' \? ([\d.]+) : ([\d.]+), ([\d.]+), ([\d.]+)\)/.exec(src('scene.js'));
  assert.ok(m, 'found the bloom settings');
  const [strengthHigh, strengthMedium, radius, threshold] = m.slice(1).map(Number);
  assert.ok(strengthHigh <= 0.3 && strengthMedium <= strengthHigh);
  assert.ok(radius <= 0.5);
  assert.ok(threshold >= 1, 'only what is brighter than white blooms');
});

test('the ball glow is sized to the ball', () => {
  const a = src('actors.js');
  const halo = /this\.halo\.scale\.set\(([\d.]+),/.exec(a);
  assert.ok(Number(halo[1]) <= 4, 'the halo is a few times the ball, not the screen');
  const hs = /const hs = ([\d.]+) \+ this\.flare \* ([\d.]+)/.exec(a);
  assert.ok(Number(hs[1]) + Number(hs[2]) <= 5.5);
  const fx = src('fx.js');
  for (const m of fx.matchAll(/mode: 'cam', gain: ([\d.]+)/g)) assert.ok(Number(m[1]) <= 1.5);
  for (const m of fx.matchAll(/r1: ([\d.]+), life: [\d.]+, mode: 'cam'/g)) assert.ok(Number(m[1]) <= 7, 'blast rings stay small enough not to fill the view');
});
