// Match-level rules: who plays, where they start, what a round is worth, who won. Pure.
import { TABLE, RING_R, PLACE_POINTS, DEFLECT_POINT_CAP, BOT_NAMES, COLORS } from './config.js';
import { mulberry32, hashString, shuffled } from './rng.js';
import { yawOf } from './sim.js';

/**
 * The roster of a match: the participants, then bots up to the table. Deterministic from the match, so every page
 * (and a new host) derives the same one. Bot ids are bot1, bot2...
 */
export function buildRoster(participants, seed, table = TABLE) {
  const humans = [...new Set((participants ?? []).filter((id) => typeof id === 'string' && id))];
  const bots = Math.max(0, table - humans.length);
  const names = shuffled(BOT_NAMES, mulberry32(hashString(`names:${seed}`)));
  const roster = humans.map((id) => ({ id, bot: false }));
  for (let i = 0; i < bots; i++) roster.push({ id: `bot${i + 1}`, bot: true, name: names[i % names.length] });
  return roster;
}

/** The colour of the n-th player of a roster. */
export const colorOf = (index) => COLORS[((index % COLORS.length) + COLORS.length) % COLORS.length];

/** Starting spots on the ring, one per roster entry (shuffled per round), each facing the centre. */
export function spawnSlots(count, seedKey) {
  const n = Math.max(1, count);
  const rng = mulberry32(hashString(`slots:${seedKey}`));
  const offset = rng() * Math.PI * 2;
  const spots = [];
  for (let i = 0; i < n; i++) {
    const a = offset + (i / n) * Math.PI * 2;
    const x = Math.cos(a) * RING_R;
    const z = Math.sin(a) * RING_R;
    spots.push({ x: round2(x), z: round2(z), yaw: round2(yawOf(-x, -z)) });
  }
  return shuffled(spots, rng);
}

/** Somewhere to stand in the lobby: a spot on a smaller ring from the player's id. */
export function lobbySpot(id) {
  const rng = mulberry32(hashString(`lobby:${id}`));
  const a = rng() * Math.PI * 2;
  const r = 9 + rng() * 7;
  const x = Math.cos(a) * r;
  const z = Math.sin(a) * r;
  return { x, z, yaw: yawOf(-x, -z) };
}

export const round2 = (v) => Math.round(v * 100) / 100;

/** Best to worst for a finished round: the winner, then the others by when they went out (last out first). */
export function placementOrder(winner, outs, roster) {
  const order = [];
  if (winner) order.push(winner);
  for (let i = outs.length - 1; i >= 0; i--) if (!order.includes(outs[i])) order.push(outs[i]);
  for (const r of roster) if (!order.includes(r.id)) order.push(r.id); // anyone missing from both (never expected)
  return order;
}

/** Points for a round: 5, 3, 2, 1 for the first four places, plus one per deflect (at most 5). */
export function roundGain(order, deflects) {
  const gain = {};
  order.forEach((id, place) => {
    gain[id] = (PLACE_POINTS[place] ?? 0) + Math.min(DEFLECT_POINT_CAP, Math.max(0, Math.floor(deflects?.[id] ?? 0)));
  });
  return gain;
}

export function addScores(scores, gain) {
  const next = { ...scores };
  for (const id of Object.keys(gain)) next[id] = (next[id] ?? 0) + gain[id];
  return next;
}

/** Final order: points, then deflects, then roster order. */
export function rankMatch(roster, scores, totals) {
  const index = new Map(roster.map((r, i) => [r.id, i]));
  return roster
    .map((r) => r.id)
    .sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0) || (totals?.[b] ?? 0) - (totals?.[a] ?? 0) || index.get(a) - index.get(b));
}

/** The match's awards from what the host tallied. Each is null until someone earns it. */
export function awardsFrom({ totals = {}, topSpeed = null, bestClash = null }) {
  let most = null;
  for (const [id, n] of Object.entries(totals)) if (n > 0 && (!most || n > most[1])) most = [id, n];
  return {
    most,
    speed: topSpeed && topSpeed[1] > 0 ? topSpeed : null,
    clash: bestClash && bestClash[1] >= 3 ? bestClash : null,
  };
}

/** "1st", "2nd"... */
export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
