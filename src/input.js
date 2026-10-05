// Keyboard, mouse (pointer lock while steering, drag-to-look where there is no lock) and touch (drag to look; the platform draws
// the stick and the buttons and presses keys for them, so keyboard handling covers those too). Nothing here throws.
const MOUSE_SENS = 0.0024;
const TOUCH_SENS = 0.0052;

export function createInput(canvas, { onPress, active }) {
  const keys = new Set();
  let jumpQ = false;
  let dashQ = false;
  let lookX = 0;
  let lookY = 0;
  let locked = false;
  let wantLock = false;
  let lockBroken = false;
  let lastEsc = -1e9;
  let drag = null; // a mouse drag (no lock)
  let touch = null; // a finger dragging
  let lostByEsc = false;

  const isGameKey = (c) => /^(Key[A-Z]|Arrow(Up|Down|Left|Right)|Space|Shift(Left|Right))$/.test(c);

  window.addEventListener('keydown', (e) => {
    if (!isGameKey(e.code)) return;
    const play = active();
    if (e.code === 'Space' || e.code.startsWith('Arrow')) {
      if (play) e.preventDefault();
    }
    if (!e.repeat) {
      if (e.code === 'Space') jumpQ = true;
      else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') dashQ = true;
      else if ((e.code === 'KeyF' || e.code === 'KeyE') && play) onPress();
    }
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => {
    keys.clear();
    drag = null;
    touch = null;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) keys.clear();
  });

  function requestLock() {
    if (locked || lockBroken || !canvas.requestPointerLock) return;
    if (performance.now() - lastEsc < 1100) return; // a lock asked for just after Esc is refused: don't ask
    try {
      const p = canvas.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(refused);
    } catch (err) {
      refused(err);
    }
  }
  function refused(err) {
    const name = err && err.name;
    if (name === 'SecurityError' || name === 'NotSupportedError') lockBroken = true;
  }
  document.addEventListener('pointerlockchange', () => {
    const now = document.pointerLockElement === canvas;
    if (locked && !now) {
      lastEsc = performance.now();
      lostByEsc = wantLock;
    }
    locked = now;
    drag = null;
  });
  document.addEventListener('pointerlockerror', () => {
    // refused (no click behind it, or too soon after Esc): the next click in the world asks again
  });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (!active()) return;
    if (e.pointerType === 'mouse') {
      if (e.button !== 0) return;
      if (locked) {
        onPress();
        return;
      }
      if (wantLock && !lockBroken) {
        requestLock();
        onPress(); // the click that takes the mouse is a deflect too
        return;
      }
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* fine */
      }
    } else if (!touch) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      // the lower left belongs to the stick
      if (e.clientX < w * 0.45 && e.clientY > h * 0.45) return;
      touch = { id: e.pointerId, x: e.clientX, y: e.clientY };
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* fine */
      }
    }
  });
  window.addEventListener('pointermove', (e) => {
    if (locked && e.pointerType === 'mouse') {
      lookX += e.movementX || 0;
      lookY += e.movementY || 0;
    } else if (drag && e.pointerId === drag.id) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      lookX += dx;
      lookY += dy;
    } else if (touch && e.pointerId === touch.id) {
      const dx = e.clientX - touch.x;
      const dy = e.clientY - touch.y;
      touch.x = e.clientX;
      touch.y = e.clientY;
      lookX += dx * (TOUCH_SENS / MOUSE_SENS);
      lookY += dy * (TOUCH_SENS / MOUSE_SENS);
    }
  });
  const up = (e) => {
    if (drag && e.pointerId === drag.id) {
      if (drag.moved < 6 && e.type === 'pointerup' && active()) onPress(); // a click, not a drag
      drag = null;
    }
    if (touch && e.pointerId === touch.id) touch = null;
  };
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);

  return {
    keys,
    get locked() {
      return locked;
    },
    get lockBroken() {
      return lockBroken;
    },
    /** True once if the lock was lost to Esc while it was wanted (show the "click to aim" hint). */
    takeEsc() {
      const v = lostByEsc;
      lostByEsc = false;
      return v;
    },
    setWantLock(v) {
      v = !!v;
      if (v === wantLock) return;
      wantLock = v;
      if (!v && locked) {
        try {
          document.exitPointerLock();
        } catch {
          /* fine */
        }
      }
    },
    get wantLock() {
      return wantLock;
    },
    /** Keyboard movement: x right, y forward, each -1..1. */
    move() {
      const k = keys;
      const x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      const y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      return { x, y };
    },
    takeJump() {
      const v = jumpQ;
      jumpQ = false;
      return v;
    },
    takeDash() {
      const v = dashQ;
      dashQ = false;
      return v;
    },
    /** Radians to turn since the last call: { dyaw, dpitch }. */
    takeLook(out) {
      const cap = (v) => Math.max(-500, Math.min(500, v));
      out.dyaw = -cap(lookX) * MOUSE_SENS;
      out.dpitch = cap(lookY) * MOUSE_SENS;
      lookX = 0;
      lookY = 0;
      return out;
    },
    clearQueue() {
      jumpQ = false;
      dashQ = false;
    },
  };
}
