// The conventions that must agree between the keyboard, the camera and the physics: forward is (sin yaw, cos yaw), the player's
// right is (-cos yaw, sin yaw), and what is on that side shows on the right of the screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraRig } from '../src/camera.js';
import { makeBody, stepBody, pickTarget } from '../src/sim.js';

function rig(yaw, pitch = 0.1, at = [0, 0, 0]) {
  const cam = new THREE.PerspectiveCamera(68, 16 / 9, 0.1, 1000);
  const r = new CameraRig(cam);
  r.yaw = yaw;
  r.pitch = pitch;
  r.follow(...at);
  r.cut();
  r.apply(0.016);
  cam.updateMatrixWorld();
  return { cam, r };
}
const ndc = (cam, p) => new THREE.Vector3(...p).project(cam);

test('over the shoulder: the player is low and a little left of centre, the world ahead is in the middle', () => {
  const { cam } = rig(0);
  const me = ndc(cam, [0, 1.2, 0]);
  assert.ok(me.x < 0 && me.x > -0.6, `player is left of centre (${me.x.toFixed(2)})`);
  assert.ok(me.y < 0, 'and low');
  const ahead = ndc(cam, [-0.9, 1.7, 20]);
  assert.ok(Math.abs(ahead.x) < 0.15, 'what the camera looks at is mid-screen');
  assert.ok(cam.position.y > 2.6 && cam.position.y < 3.8, `camera height about 3 (${cam.position.y.toFixed(2)})`);
  const back = Math.hypot(cam.position.x, cam.position.z);
  assert.ok(back > 6 && back < 8, `about seven behind (${back.toFixed(2)})`);
});

test('the right of the player is the right of the screen, whichever way they face', () => {
  for (const yaw of [0, 0.8, Math.PI / 2, 2.5, -1.3, Math.PI]) {
    const { cam } = rig(yaw);
    const f = [Math.sin(yaw), 0, Math.cos(yaw)];
    const right = [-Math.cos(yaw), 0, Math.sin(yaw)];
    const p = [f[0] * 15 + right[0] * 6, 1.2, f[2] * 15 + right[2] * 6];
    const q = [f[0] * 15 - right[0] * 6, 1.2, f[2] * 15 - right[2] * 6];
    assert.ok(ndc(cam, p).x > 0.15, `yaw ${yaw}: to the right`);
    assert.ok(ndc(cam, q).x < -0.15, `yaw ${yaw}: to the left`);
  }
});

test('W walks away from the camera and D to the right of the screen', () => {
  const yaw = 1.1;
  const b = makeBody(0, 0, yaw);
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const move = (x, y) => ({ mx: sy * y - cy * x, mz: cy * y + sy * x });
  for (let i = 0; i < 30; i++) stepBody(b, move(0, 1), 1 / 60);
  assert.ok(b.x * sy + b.z * cy > 3, 'forward');
  const c = makeBody(0, 0, yaw);
  for (let i = 0; i < 30; i++) stepBody(c, move(1, 0), 1 / 60);
  const { cam } = rig(yaw);
  assert.ok(ndc(cam, [c.x, 1.2, c.z]).x > 0.1, 'D goes to the right on the screen');
});

test('the deflect aim is the camera: the player straight ahead of the crosshair gets the ball', () => {
  for (const yaw of [0, 1, 2.2, -2.7]) {
    const f = [Math.sin(yaw), Math.cos(yaw)];
    const r = [-Math.cos(yaw), Math.sin(yaw)];
    const cands = [
      { id: 'ahead', x: f[0] * 14 + r[0] * 1, z: f[1] * 14 + r[1] * 1 },
      { id: 'right', x: r[0] * 10, z: r[1] * 10 },
      { id: 'behind', x: -f[0] * 12, z: -f[1] * 12 },
    ];
    assert.equal(pickTarget(0, 0, yaw, cands, 'me'), 'ahead');
    assert.equal(pickTarget(0, 0, yaw - Math.PI / 2, cands, 'me'), 'right', 'turn right: the player on the right');
    assert.equal(pickTarget(0, 0, yaw + Math.PI, cands, 'me'), 'behind');
  }
});

test('orbiting looks at the middle from the side it says, and a turn of the mouse turns the right way', () => {
  const cam = new THREE.PerspectiveCamera(68, 16 / 9, 0.1, 1000);
  const r = new CameraRig(cam);
  r.orbit(0, 0, 0, 0, 30, 15, 0);
  r.cut();
  r.apply(0.016);
  cam.updateMatrixWorld();
  assert.ok(Math.abs(ndc(cam, [0, 1.2, 0]).x) < 0.05, 'the middle is mid-screen');
  // mouse right: the yaw goes down, and what was to the right comes to the middle
  const a = rig(0).r;
  a.turn(-0.3, 0);
  assert.ok(a.yaw < 0);
  const f = [Math.sin(a.yaw), Math.cos(a.yaw)];
  assert.ok(f[0] < 0, 'looking towards -x, which is the right-hand side of someone facing +z');
});
