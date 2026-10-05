// Where everything stands in the store pictures. Pure data (and the maths for the camera), so a test can check that the subject
// is in the frame without anyone opening a browser.
import { yawOf } from './sim.js';
import { COLORS, BOT_NAMES } from './config.js';

export const POSTER_SIZES = { cover: [1280, 720], action: [1280, 720], win: [1280, 720], icon: [512, 512] };

const ring = (i, n, r, a0) => {
  const a = a0 + (i / n) * Math.PI * 2;
  const x = Math.cos(a) * r;
  const z = Math.sin(a) * r;
  return { x, z, yaw: yawOf(-x, -z) };
};
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const fwdOf = (yaw) => [Math.sin(yaw), 0, Math.cos(yaw)];
const rightOf = (yaw) => [-Math.cos(yaw), 0, Math.sin(yaw)];

function cast(poses) {
  return poses.map((p, i) => ({ id: `p${i}`, name: BOT_NAMES[i], color: COLORS[i % COLORS.length], x: p.x, z: p.z, yaw: p.yaw, swing: p.swing ?? null, y: p.y ?? 0 }));
}

/** A trail from the newest point back along a path: `legs` is a list of [from, to, count]. */
function trail(legs) {
  const pts = [];
  for (const [a, b, n] of legs) {
    for (let i = 0; i < n; i++) {
      const t = i / n;
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return pts;
}

export function layout(name) {
  if (name === 'action') {
    const people = cast([
      { x: -4.7, z: 0, yaw: Math.PI / 2, swing: 0.1 },
      { x: 4.7, z: 0, yaw: -Math.PI / 2, swing: 0.11 },
      ...[2, 3, 4, 5, 6, 7].map((i) => ring(i, 8, 18, 0.5)),
    ]);
    const ball = [0, 1.55, 0];
    const cam = [0.6, 1.55, 8.4];
    return {
      name, w: 1280, h: 720, fov: 50, cam, look: [0, 1.5, 0], people,
      ball: { pos: ball, color: COLORS[0], flare: 0.45, points: trail([[ball, [9.5, 1.7, 0.2], 18], [[9.5, 1.7, 0.2], [17, 2.6, 0.5], 38]]) },
      rings: [{ pos: ball, mode: 'cam', r1: 3.4, color: COLORS[0], age: 0.12 }, { pos: [0, 0.06, 0], mode: 'ground', r1: 6.5, color: COLORS[1], age: 0.16 }],
      sparks: [{ pos: ball, dir: [0, 0.3, 1], color: COLORS[0], power: 0.9 }, { pos: ball, dir: [0, 0.3, -1], color: COLORS[1], power: 0.9 }],
      key: { a: [-4.7, 1.2, 0], b: [4.7, 1.2, 0], ball },
    };
  }
  if (name === 'win') {
    const people = cast([
      { x: 0, z: 0, yaw: 0, swing: 0.27 },
      ...[1, 2, 3, 4, 5, 6, 7].map((i) => ring(i, 8, 7.5, 0.3)),
    ]);
    return {
      name, w: 1280, h: 720, fov: 50, cam: [0.5, 0.95, 6.6], look: [0, 1.45, 0], people, hidden: [1, 2, 3, 4, 5, 6, 7],
      shards: people.slice(1).map((p, i) => {
        // the fallen: behind and beside the winner, never between them and the camera
        const a = Math.PI + 0.3 + (i * (Math.PI - 0.6)) / 6;
        const r = 3.2 + (i % 3) * 1.5;
        return { x: Math.cos(a) * r, y: 0.5, z: Math.sin(a) * r, color: p.color };
      }),
      rings: [{ pos: [0, 0.06, 0], mode: 'ground', r1: 6, color: COLORS[0], age: 0.3 }],
      confetti: { x: 0, z: -2, n: 200, age: 0.9 },
      key: { winner: [0, 1.2, 0] },
    };
  }
  if (name === 'icon') {
    // the camera looks up into the dark sky from far above the arena; everything is placed in front of it
    const cam = [0, 60, 0];
    const f = norm([0, 0.8, -1]);
    const r = [1, 0, 0];
    const u = norm([0, 1, 0.8]);
    const at = (x, y, z) => add(add(add(cam, r, x), u, y), f, z);
    const ball = at(0.2, -0.3, 7.5);
    return {
      name, w: 512, h: 512, fov: 40, cam, look: add(cam, f, 10), icon: true, people: [],
      ball: { pos: ball, color: COLORS[0], flare: 0.55, scale: 1.05, points: trail([[ball, at(-5.5, 5.2, 7.8), 40], [at(-5.5, 5.2, 7.8), at(-11, 11, 8.4), 16]]) },
      arc: { center: at(0.4, -0.6, 7.2), radius: 2.5, from: 3.6, to: 5.6 },
      key: { ball, arcCenter: at(0.4, -0.6, 7.2) },
      axes: { r, u, f },
    };
  }
  // cover
  const a0 = Math.atan2(15, 6);
  const p0 = ring(0, 8, Math.hypot(6, 15), a0);
  const others = [1, 2, 3, 4, 5, 6, 7].map((i) => ring(i, 8, 16.2, a0));
  const people = cast([{ ...p0, swing: 0.1 }, ...others]);
  const A = [p0.x, 0, p0.z];
  const B = [others[2].x, 0, others[2].z]; // three seats round: the far side
  const fA = fwdOf(p0.yaw);
  const rA = rightOf(p0.yaw);
  const dir = norm(sub(B, A));
  const contact = [A[0] + dir[0] * 1.3, 1.55, A[2] + dir[2] * 1.3];
  const ball = [A[0] + dir[0] * 4.6, 1.8, A[2] + dir[2] * 4.6];
  // over the hero's shoulder, off to the side, so the line from the blade to the target runs across the picture
  const cam = [A[0] - fA[0] * 3.4 + rA[0] * 5, 2.4, A[2] - fA[2] * 3.4 + rA[2] * 5];
  const look = [ball[0] + dir[0] * 16, 2.3, ball[2] + dir[2] * 16];
  return {
    name, w: 1280, h: 720, fov: 62, cam, look, people, targetIndex: 3,
    ball: { pos: ball, color: COLORS[3], flare: 0.5, points: trail([[ball, contact, 8], [contact, [0, 1.6, 0], 40], [[0, 1.6, 0], [-6, 1.8, -12], 8]]) },
    rings: [{ pos: contact, mode: 'cam', r1: 2.8, color: COLORS[0], age: 0.12 }, { pos: [contact[0], 0.06, contact[2]], mode: 'ground', r1: 5, color: COLORS[0], age: 0.2 }],
    sparks: [{ pos: contact, dir, color: COLORS[0], power: 0.6 }],
    key: { hero: [A[0], 1.2, A[2]], ball, target: [B[0], 1.5, B[2]] },
  };
}
