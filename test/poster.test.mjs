// The store pictures are staged from data: check that the subject is inside the frame, where it should be, without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { layout, POSTER_SIZES } from '../src/posterlayout.js';

function project(L, p) {
  const cam = new THREE.PerspectiveCamera(L.fov, L.w / L.h, 0.1, 1200);
  cam.position.set(...L.cam);
  cam.lookAt(new THREE.Vector3(...L.look));
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return new THREE.Vector3(...p).project(cam);
}

test('every poster has a size the platform wants', () => {
  assert.deepEqual(POSTER_SIZES.cover, [1280, 720]);
  assert.deepEqual(POSTER_SIZES.action, [1280, 720]);
  assert.deepEqual(POSTER_SIZES.win, [1280, 720]);
  assert.deepEqual(POSTER_SIZES.icon, [512, 512]);
});

test('the subjects of each picture are in front of the camera and well inside the frame', () => {
  for (const name of Object.keys(POSTER_SIZES)) {
    const L = layout(name);
    assert.equal(L.w, POSTER_SIZES[name][0]);
    assert.equal(L.h, POSTER_SIZES[name][1]);
    for (const [k, v] of Object.entries(L.key)) {
      if (!Array.isArray(v) || v.length !== 3) continue;
      const p = project(L, v);
      assert.ok(p.z > 0 && p.z < 1, `${name}.${k} is in front of the camera`);
      assert.ok(Math.abs(p.x) < 0.8 && Math.abs(p.y) < 0.8, `${name}.${k} is inside the frame (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
    }
  }
});

test('the cover keeps its subjects below the title (the top third) and the ball between the hero and the target', () => {
  const L = layout('cover');
  const hero = project(L, L.key.hero);
  const ball = project(L, L.key.ball);
  const target = project(L, L.key.target);
  for (const p of [hero, ball, target]) assert.ok(p.y < 0.25, 'under the title');
  assert.ok(hero.x < ball.x && ball.x < target.x + 0.05, 'the hero, the ball, the target, left to right');
});

test('the action picture is a clash: two players, one each side of the ball', () => {
  const L = layout('action');
  const a = project(L, L.key.a);
  const b = project(L, L.key.b);
  const ball = project(L, L.key.ball);
  assert.ok(a.x < ball.x && ball.x < b.x);
  assert.ok(Math.abs(ball.x) < 0.1);
});

test('the icon has one hero subject, centred, nothing in the outer tenth', () => {
  const L = layout('icon');
  const ball = project(L, L.key.ball);
  assert.ok(Math.abs(ball.x) < 0.3 && Math.abs(ball.y) < 0.3);
  const arc = project(L, L.key.arcCenter);
  assert.ok(Math.abs(arc.x) < 0.45 && Math.abs(arc.y) < 0.45);
  // the trail runs off to the upper left: its far end is allowed out of frame, its start is not
  const s = L.ball.points[0];
  const p = project(L, s);
  assert.ok(Math.abs(p.x) < 0.9 && Math.abs(p.y) < 0.9);
});

test('the win picture has the winner centred', () => {
  const L = layout('win');
  const w = project(L, L.key.winner);
  assert.ok(Math.abs(w.x) < 0.1);
  assert.equal(L.shards.length, 7);
});
