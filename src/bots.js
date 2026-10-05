// Bots: they wander, strafe when the ball is theirs, and press Deflect with a reaction time and an error that grows with
// the ball's speed (they handle slow balls, and start failing somewhere between 100 and 180 u/s). Pure.
import { CHEST, HIT_R, ARENA_R } from './config.js';
import { gauss } from './rng.js';
import { yawOf } from './sim.js';

const TAU = Math.PI * 2;

export function makeBrain(rng) {
  const skill = 0.5 + rng() * 0.45;
  return {
    skill,
    reaction: 0.22 - 0.09 * skill,
    angle: rng() * TAU,
    orbit: rng() < 0.5 ? -1 : 1,
    radius: 9 + rng() * 9,
    strafeDir: rng() < 0.5 ? -1 : 1,
    strafeT: 0,
    plan: null,
    threat: rng() < 0.5,
    jumpT: 2 + rng() * 5,
    faceYaw: 0,
  };
}

/** What the bot decides to do this step. `me`: { id, body }. `ctx`: { t, ball, others: [{ id, x, z, deflects }] } (alive others). */
export function think(brain, me, ctx, dt, rng) {
  const b = me.body;
  const ball = ctx.ball;
  const out = { mx: 0, mz: 0, jump: false, dash: false, press: false, face: brain.faceYaw };

  // Where it would like to stand: a slowly turning spot on its own circle.
  brain.angle += brain.orbit * dt * 0.22;
  let mx = 0;
  let mz = 0;
  const tx = Math.cos(brain.angle) * brain.radius;
  const tz = Math.sin(brain.angle) * brain.radius;
  const dx = tx - b.x;
  const dz = tz - b.z;
  const dl = Math.hypot(dx, dz);
  if (dl > 0.8) {
    const k = Math.min(1, dl / 3);
    mx = (dx / dl) * k;
    mz = (dz / dl) * k;
  }
  // Keep a little room from the others.
  for (const o of ctx.others) {
    if (o.id === me.id) continue;
    const ox = b.x - o.x;
    const oz = b.z - o.z;
    const d = Math.hypot(ox, oz);
    if (d < 4 && d > 1e-3) {
      const push = ((4 - d) / 4) * 1.2;
      mx += (ox / d) * push;
      mz += (oz / d) * push;
    }
  }

  const targeted = ball.active && ball.target === me.id && !ball.pend && ball.hold <= 0;
  let tti = Infinity;
  let bx = 0;
  let bz = 0;
  let bl = 1;
  if (targeted) {
    bx = ball.x - b.x;
    bz = ball.z - b.z;
    bl = Math.hypot(bx, bz) || 1;
    const d3 = Math.hypot(ball.x - b.x, ball.y - (b.y + CHEST), ball.z - b.z);
    tti = Math.max(0, d3 - HIT_R) / Math.max(1, ball.speed);
    brain.strafeT -= dt;
    if (brain.strafeT <= 0) {
      brain.strafeDir = -brain.strafeDir;
      brain.strafeT = 0.6 + rng() * 0.9;
    }
    const sx = (-bz / bl) * brain.strafeDir * 0.55;
    const sz = (bx / bl) * brain.strafeDir * 0.55;
    mx = mx * 0.4 + sx;
    mz = mz * 0.4 + sz;
  }

  // Stay on the disc.
  const r = Math.hypot(b.x, b.z);
  if (r > 19.5) {
    const k = Math.min(1, (r - 19.5) / 3.5);
    mx -= (b.x / r) * k * 3;
    mz -= (b.z / r) * k * 3;
  }
  if (r > ARENA_R - 2.2) {
    // nearly over the edge: head straight back, no matter what
    mx = -b.x / r;
    mz = -b.z / r;
  }
  out.mx = mx;
  out.mz = mz;

  // The plan for a ball that has just locked on.
  if (targeted) {
    if (!brain.plan || brain.plan.n !== ball.lock) {
      const sigma = (0.008 + 0.0005 * ball.speed) * (1.5 - brain.skill);
      const dodge = ball.speed < 45 && rng() < 0.015; // now and then one tries to sidestep, and mostly fails
      const aim = 0.12 + gauss(rng) * sigma;
      brain.plan = { n: ball.lock, press: !dodge && aim > 0.01, at: aim, dodge, readyAt: ctx.t + brain.reaction + rng() * 0.03, done: false };
    }
    const plan = brain.plan;
    if (!plan.done && ctx.t >= plan.readyAt && tti <= plan.at) {
      plan.done = true;
      if (plan.dodge) {
        out.dash = true;
        out.mx = (-bz / bl) * brain.strafeDir;
        out.mz = (bx / bl) * brain.strafeDir;
      } else if (plan.press) out.press = true;
    }
  } else if (brain.plan && !ball.active) brain.plan = null;

  // A hop now and then.
  brain.jumpT -= dt;
  if (brain.jumpT <= 0) {
    brain.jumpT = 3 + rng() * 6;
    if (b.ground && !targeted) out.jump = true;
  }

  // Face where it is going, or at the ball.
  if (targeted) brain.faceYaw = yawOf(bx, bz);
  else if (Math.hypot(mx, mz) > 0.3) brain.faceYaw = yawOf(mx, mz);
  else brain.faceYaw = yawOf(-b.x, -b.z);
  out.face = brain.faceYaw;
  return out;
}

/** Who a bot sends the ball to: the round's leader (a "threat") or a random other. `others`: [{ id, deflects }] (alive, not itself). */
export function chooseTo(brain, others, rng) {
  if (others.length === 0) return null;
  if (brain.threat) {
    let best = others[0];
    for (const o of others) if ((o.deflects ?? 0) > (best.deflects ?? 0)) best = o;
    if ((best.deflects ?? 0) > 0) return best.id;
  }
  return others[Math.floor(rng() * others.length) % others.length].id;
}
