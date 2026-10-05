import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installClock } from './dom.mjs';

test('keys, clicks, pointer lock and dragging do what the game expects', async () => {
  const dom = installDom();
  installClock();
  const { createInput } = await import('../src/input.js');
  const canvas = dom.byId.get('c');
  let presses = 0;
  let active = true;
  let locks = 0;
  canvas.requestPointerLock = () => {
    locks++;
    return Promise.resolve();
  };
  const input = createInput(canvas, { onPress: () => presses++, active: () => active });
  const win = (type, e) => dom.dispatchWindow(type, { repeat: false, ...e });

  // keys
  win('keydown', { code: 'KeyW' });
  win('keydown', { code: 'ArrowRight' });
  assert.deepEqual(input.move(), { x: 1, y: 1 });
  win('keyup', { code: 'KeyW' });
  win('keyup', { code: 'ArrowRight' });
  assert.deepEqual(input.move(), { x: 0, y: 0 });
  win('keydown', { code: 'KeyA' });
  win('keydown', { code: 'KeyD' });
  assert.equal(input.move().x, 0, 'both ways cancel');
  win('keyup', { code: 'KeyA' });
  win('keyup', { code: 'KeyD' });

  // jump and dash are one-shot, and held keys repeat nothing
  win('keydown', { code: 'Space' });
  win('keydown', { code: 'Space', repeat: true });
  assert.equal(input.takeJump(), true);
  assert.equal(input.takeJump(), false);
  win('keydown', { code: 'ShiftLeft' });
  assert.equal(input.takeDash(), true);
  assert.equal(input.takeDash(), false);

  // deflect: F and E, once each, not on a repeat, not when the game isn't active
  win('keydown', { code: 'KeyF' });
  win('keydown', { code: 'KeyF', repeat: true });
  win('keydown', { code: 'KeyE' });
  assert.equal(presses, 2);
  active = false;
  win('keydown', { code: 'KeyF' });
  assert.equal(presses, 2);
  active = true;

  // a free mouse: a click deflects (on release), a drag turns the camera and deflects nothing
  const look = { dyaw: 0, dpitch: 0 };
  canvas.dispatch('pointerdown', { pointerType: 'mouse', button: 0, pointerId: 1, clientX: 100, clientY: 100 });
  win('pointerup', { pointerType: 'mouse', pointerId: 1, clientX: 101, clientY: 100 });
  assert.equal(presses, 3, 'a click');
  canvas.dispatch('pointerdown', { pointerType: 'mouse', button: 0, pointerId: 1, clientX: 100, clientY: 100 });
  win('pointermove', { pointerType: 'mouse', pointerId: 1, clientX: 160, clientY: 90 });
  win('pointerup', { pointerType: 'mouse', pointerId: 1, clientX: 160, clientY: 90 });
  assert.equal(presses, 3, 'a drag is not a click');
  input.takeLook(look);
  assert.ok(look.dyaw < 0 && look.dpitch < 0, 'dragging right and up turns right and looks up');

  // while steering: the first click asks for the lock (and deflects), and with the lock the mouse turns the camera
  input.setWantLock(true);
  canvas.dispatch('pointerdown', { pointerType: 'mouse', button: 0, pointerId: 1, clientX: 5, clientY: 5 });
  assert.equal(locks, 1);
  assert.equal(presses, 4);
  dom.doc.pointerLockElement = canvas;
  dom.doc.dispatch('pointerlockchange');
  assert.equal(input.locked, true);
  win('pointermove', { pointerType: 'mouse', movementX: 10, movementY: 4 });
  input.takeLook(look);
  assert.ok(look.dyaw < 0 && look.dpitch > 0);
  canvas.dispatch('pointerdown', { pointerType: 'mouse', button: 0, pointerId: 1 });
  assert.equal(presses, 5, 'every click deflects while locked');
  // Esc: the lock is lost; a click right after does not ask again, a later one does
  dom.doc.pointerLockElement = null;
  dom.doc.dispatch('pointerlockchange');
  assert.equal(input.locked, false);
  assert.equal(input.takeEsc(), true);
  canvas.dispatch('pointerdown', { pointerType: 'mouse', button: 0, pointerId: 1 });
  assert.equal(locks, 1, 'not within a second of Esc');
  assert.equal(presses, 6);
  // leaving the world gives the mouse back
  dom.doc.pointerLockElement = canvas;
  dom.doc.dispatch('pointerlockchange');
  let exited = 0;
  dom.doc.exitPointerLock = () => exited++;
  input.setWantLock(false);
  assert.equal(exited, 1);

  // touch: a drag in the right half turns the camera; the stick's corner is not ours
  canvas.dispatch('pointerdown', { pointerType: 'touch', pointerId: 7, clientX: 1000, clientY: 300 });
  win('pointermove', { pointerType: 'touch', pointerId: 7, clientX: 1040, clientY: 300 });
  win('pointerup', { pointerType: 'touch', pointerId: 7 });
  input.takeLook(look);
  assert.ok(look.dyaw < 0);
  canvas.dispatch('pointerdown', { pointerType: 'touch', pointerId: 8, clientX: 100, clientY: 600 });
  win('pointermove', { pointerType: 'touch', pointerId: 8, clientX: 200, clientY: 600 });
  input.takeLook(look);
  assert.equal(Math.abs(look.dyaw), 0, 'the stick zone');
  win('pointerup', { pointerType: 'touch', pointerId: 8 });
  assert.equal(presses, 6, 'a touch on the world is not a deflect: the button is');
});
