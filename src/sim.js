// Physics and small rules of the game: bodies, the ball, the deflect window. Pure: no three.js, no DOM, no SDK.
import {
  ARENA_R, FALL_Y, BALL_R, CHEST, MOVE_SPEED, JUMP_V, GRAVITY, DASH_SPEED, DASH_TIME, DASH_CD, WINDOW, DEFLECT_CD, CONE_HALF,
  SPEED_START, SPEED_STEP, SPEED_RAMP, RAMP_GROW, SPEED_MAX, clamp, num,
} from './config.js';

// ---------------------------------------------------------------- angles
const TAU = Math.PI * 2;
export function wrapAngle(a) {
  a = a % TAU;
  if (a > Math.PI) a -= TAU;
  else if (a < -Math.PI) a += TAU;
  return a;
}
export function lerpAngle(a, b, t) {
  return a + wrapAngle(b - a) * t;
}
/** Yaw of a direction on the ground: forward is (sin yaw, cos yaw). */
export const yawOf = (dx, dz) => Math.atan2(dx, dz);

// ---------------------------------------------------------------- bodies
export function makeBody(x = 0, z = 0, yaw = 0) {
  return { x, y: 0, z, vx: 0, vy: 0, vz: 0, yaw, ground: true, dash: 0, dashCd: 0, dx: 0, dz: 1, speed: 0, dashed: false, jumped: false, landed: false };
}

export const onArena = (x, z) => x * x + z * z <= ARENA_R * ARENA_R;

/** True when the body fell far enough to be out (or its numbers broke). */
export const fellOut = (b) => !(b.y > FALL_Y) || !Number.isFinite(b.x) || !Number.isFinite(b.z);

/**
 * One fixed step of a walking, jumping, dashing body.
 * input: { mx, mz } desired direction in world space (length up to 1: analog), `jump` and `dash` true on the step they are
 * asked for, `face` an optional yaw to turn towards. Sets b.dashed / b.jumped / b.landed for one step so sound can follow.
 */
export function stepBody(b, input, dt) {
  b.dashed = false;
  b.jumped = false;
  b.landed = false;
  let mx = num(input.mx);
  let mz = num(input.mz);
  const len = Math.hypot(mx, mz);
  if (len > 1) {
    mx /= len;
    mz /= len;
  }
  const want = Math.min(1, len);

  b.dashCd = Math.max(0, b.dashCd - dt);
  if (input.dash && b.dashCd <= 0 && b.dash <= 0) {
    if (len > 0.1) {
      b.dx = mx / Math.min(1, len);
      b.dz = mz / Math.min(1, len);
      const l = Math.hypot(b.dx, b.dz) || 1;
      b.dx /= l;
      b.dz /= l;
    } else {
      b.dx = Math.sin(b.yaw);
      b.dz = Math.cos(b.yaw);
    }
    b.dash = DASH_TIME;
    b.dashCd = DASH_CD;
    b.dashed = true;
  }

  if (b.dash > 0) {
    b.vx = b.dx * DASH_SPEED;
    b.vz = b.dz * DASH_SPEED;
    b.dash -= dt;
  } else {
    const k = Math.min(1, (b.ground ? 16 : 5) * dt);
    b.vx += (mx * MOVE_SPEED - b.vx) * k;
    b.vz += (mz * MOVE_SPEED - b.vz) * k;
    if (want < 0.01 && Math.hypot(b.vx, b.vz) < 0.05) {
      b.vx = 0;
      b.vz = 0;
    }
  }
  b.x += b.vx * dt;
  b.z += b.vz * dt;
  b.speed = Math.hypot(b.vx, b.vz);

  const over = onArena(b.x, b.z);
  if (b.ground) {
    if (!over) b.ground = false; // walked off the edge
    else if (input.jump) {
      b.vy = JUMP_V;
      b.ground = false;
      b.jumped = true;
    }
  }
  if (!b.ground) {
    b.vy -= GRAVITY * dt;
    b.y += b.vy * dt;
    // landing: only from above the floor, never from under it
    if (over && b.vy <= 0 && b.y <= 0 && b.y > -0.6) {
      b.y = 0;
      b.vy = 0;
      b.ground = true;
      b.landed = true;
    }
  }

  if (typeof input.face === 'number' && Number.isFinite(input.face)) b.yaw = lerpAngle(b.yaw, input.face, Math.min(1, 14 * dt));
  return b;
}

// ---------------------------------------------------------------- the deflect window
export function makeDeflector() {
  return { winStart: -1, winUntil: -1, cdUntil: 0, presses: 0 };
}
/** Press Deflect at `now` (seconds): opens the window unless it is cooling down. */
export function pressDeflect(d, now) {
  if (now < d.cdUntil) return false;
  d.winStart = now;
  d.winUntil = now + WINDOW;
  d.cdUntil = now + DEFLECT_CD;
  d.presses++;
  return true;
}
export const windowOpen = (d, now) => d.winUntil >= 0 && now >= d.winStart && now <= d.winUntil;
/** A deflect that worked closes the window and gives the button back at once (that is what makes a clash possible). */
export function deflectWorked(d, now) {
  d.winUntil = -1;
  d.cdUntil = now;
}
/** 0 ready .. 1 just pressed, for the button. */
export const cooldownFrac = (d, now) => clamp((d.cdUntil - now) / DEFLECT_CD, 0, 1);

// ---------------------------------------------------------------- the ball
export function makeBall() {
  return {
    x: 0, y: 1.6, z: 0, vx: 0, vy: 0, vz: 0, px: 0, py: 1.6, pz: 0,
    speed: SPEED_START, n: 0, target: null, by: null, lock: 0,
    active: false, pend: 0, pendT: 0, hold: 0, age: 0,
  };
}
export function copyBall(into, from) {
  for (const k in from) into[k] = from[k];
  return into;
}

/** u/s gained per second at this age of the ball: it climbs faster the longer a round drags on. */
export const rampAt = (age) => SPEED_RAMP * (1 + age * RAMP_GROW);
export const turnRate = (speed) => 3.2 + speed * 0.018;
const CAPTURE = 2.6;
export const liftFor = (dist) => clamp((dist - 10) * 0.12, 0, 4.5);

/** Move the ball one step toward a point (the target's chest), turning at a limited rate, arcing up when far. */
export function stepBall(b, tx, ty, tz, dt) {
  b.px = b.x;
  b.py = b.y;
  b.pz = b.z;
  let dx = tx - b.x;
  let dy = ty - b.y;
  let dz = tz - b.z;
  const dist = Math.hypot(dx, dy, dz);
  dy += liftFor(dist);
  const dl = Math.hypot(dx, dy, dz) || 1;
  dx /= dl;
  dy /= dl;
  dz /= dl;
  let vl = Math.hypot(b.vx, b.vy, b.vz);
  let cx, cy, cz;
  if (vl < 1e-6) {
    cx = dx;
    cy = dy;
    cz = dz;
  } else {
    cx = b.vx / vl;
    cy = b.vy / vl;
    cz = b.vz / vl;
  }
  const dot = clamp(cx * dx + cy * dy + cz * dz, -1, 1);
  const ang = Math.acos(dot);
  // Far away it arcs at a limited rate; close in it turns as tightly as it needs to, so it always arrives (a target inside
  // its turning circle would otherwise be orbited for ever).
  const maxA = Math.max(turnRate(b.speed), (CAPTURE * b.speed) / Math.max(dist, 1.5)) * dt;
  let nx, ny, nz;
  if (ang <= maxA || ang < 1e-5) {
    nx = dx;
    ny = dy;
    nz = dz;
  } else {
    let qx = dx - cx * dot;
    let qy = dy - cy * dot;
    let qz = dz - cz * dot;
    let ql = Math.hypot(qx, qy, qz);
    if (ql < 1e-6) {
      // straight behind: any sideways direction will do
      if (Math.abs(cy) < 0.9) {
        qx = -cz;
        qy = 0;
        qz = cx;
      } else {
        qx = 1;
        qy = 0;
        qz = 0;
      }
      ql = Math.hypot(qx, qy, qz) || 1;
    }
    qx /= ql;
    qy /= ql;
    qz /= ql;
    const c = Math.cos(maxA);
    const s = Math.sin(maxA);
    nx = cx * c + qx * s;
    ny = cy * c + qy * s;
    nz = cz * c + qz * s;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
  }
  b.vx = nx * b.speed;
  b.vy = ny * b.speed;
  b.vz = nz * b.speed;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
  if (b.y < 0.8) b.y = 0.8;
  return b;
}

/** Did the ball's last step pass within `r` of the point? (a swept test: a 220 u/s ball moves 3.7 u a step.) */
export function sweptHit(b, cx, cy, cz, r) {
  const dx = b.x - b.px;
  const dy = b.y - b.py;
  const dz = b.z - b.pz;
  const l2 = dx * dx + dy * dy + dz * dz;
  let t = l2 > 1e-9 ? ((cx - b.px) * dx + (cy - b.py) * dy + (cz - b.pz) * dz) / l2 : 0;
  t = clamp(t, 0, 1);
  const qx = b.px + dx * t - cx;
  const qy = b.py + dy * t - cy;
  const qz = b.pz + dz * t - cz;
  return qx * qx + qy * qy + qz * qz <= r * r;
}

/** Point the ball's velocity at a spot (the arc included), keeping its speed. */
export function aimBall(b, tx, ty, tz) {
  let dx = tx - b.x;
  let dy = ty - b.y;
  let dz = tz - b.z;
  const dist = Math.hypot(dx, dy, dz);
  dy += liftFor(dist);
  const l = Math.hypot(dx, dy, dz);
  if (l < 1e-6) {
    dx = 0;
    dy = 0;
    dz = 1;
  } else {
    dx /= l;
    dy /= l;
    dz /= l;
  }
  b.vx = dx * b.speed;
  b.vy = dy * b.speed;
  b.vz = dz * b.speed;
  return b;
}

/** Send the ball off at a new target, faster. The caller sets `target` and `by`. */
export function redirectBall(b, tx, ty, tz) {
  b.n++;
  b.lock++;
  b.speed = Math.min(SPEED_MAX, b.speed + SPEED_STEP);
  aimBall(b, tx, ty, tz);
  b.pend = 0;
  b.pendT = 0;
  b.hold = 0;
  return b;
}

export const chestOf = (p) => ({ x: p.x, y: p.y + CHEST, z: p.z });

// ---------------------------------------------------------------- who gets it next
/**
 * The player an aim picks: the one nearest the aim direction inside the cone, else the nearest. `cands`: [{ id, x, z }].
 * `aim` is a yaw (forward is (sin, cos)). Returns an id or null.
 */
export function pickTarget(fx, fz, aim, cands, excludeId) {
  let best = null;
  let bestAng = CONE_HALF;
  let nearest = null;
  let nd = Infinity;
  for (const c of cands) {
    if (c.id === excludeId) continue;
    const dx = c.x - fx;
    const dz = c.z - fz;
    const d2 = dx * dx + dz * dz;
    if (d2 < nd) {
      nd = d2;
      nearest = c;
    }
    if (d2 < 1e-6) continue;
    const ang = Math.abs(wrapAngle(Math.atan2(dx, dz) - aim));
    if (ang < bestAng) {
      bestAng = ang;
      best = c;
    }
  }
  const chosen = best ?? nearest;
  return chosen ? chosen.id : null;
}

export { BALL_R };
