// Shared helpers for the tests: play rounds and whole matches with only bots, through the pure modules.
import { STEP, ARENA_R, FALL_Y } from '../src/config.js';
import { Round } from '../src/round.js';
import { buildRoster, spawnSlots, placementOrder, roundGain, addScores, rankMatch, awardsFrom } from '../src/match.js';
import { mulberry32 } from '../src/rng.js';

export const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** Play one round to its end. Returns what happened, and checks as it goes. */
export function playRound({ roster, seed, rid = 'm.1', brains = new Map(), maxSeconds = 900, rampScale = 1, onStep }) {
  const slots = spawnSlots(roster.length, `${rid}`);
  const round = new Round({ rid, roster, slots, seed, brains, rampScale });
  const events = [];
  let steps = 0;
  let maxSpeed = 0;
  let worstRadius = 0;
  const problems = [];
  const limit = Math.ceil(maxSeconds / STEP);
  while (!round.over && steps < limit) {
    round.step(STEP);
    steps++;
    const b = round.ball;
    if (![b.x, b.y, b.z, b.vx, b.vy, b.vz, b.speed].every(finite)) problems.push(`ball NaN at step ${steps}`);
    maxSpeed = Math.max(maxSpeed, b.speed);
    for (const p of round.list) {
      const q = p.body;
      if (![q.x, q.y, q.z].every(finite)) problems.push(`${p.id} NaN at step ${steps}`);
      if (p.alive) {
        worstRadius = Math.max(worstRadius, Math.hypot(q.x, q.z));
        if (q.y < FALL_Y) problems.push(`${p.id} alive below the floor`);
      }
    }
    for (const e of round.drain()) events.push({ ...e, t: round.t });
    onStep?.(round, steps);
  }
  return { round, events, steps, seconds: round.t, maxSpeed, worstRadius, problems, finished: round.over };
}

/** A whole match of bots through the same rules the host uses. */
export function playMatch({ seed, rounds = 5, humans = 0, table = 8, maxSeconds = 900 }) {
  const rng = mulberry32(seed);
  const participants = Array.from({ length: humans }, (_, i) => `h${i + 1}`);
  const roster = buildRoster(participants, seed, table);
  // "humans" here are bots with names: every seat is judged by the engine, which is what an away player is
  const brains = new Map();
  let scores = Object.fromEntries(roster.map((r) => [r.id, 0]));
  const totals = {};
  const log = [];
  let topSpeed = [null, 0];
  let bestClash = [null, 0];
  const problems = [];
  for (let n = 1; n <= rounds; n++) {
    const rosterBots = roster.map((r) => ({ ...r, bot: true }));
    const res = playRound({ roster: rosterBots, seed: Math.floor(rng() * 2 ** 32), rid: `m${seed}.${n}`, brains, maxSeconds });
    problems.push(...res.problems);
    if (!res.finished) problems.push(`round ${n} never ended`);
    const order = placementOrder(res.round.winner, res.round.outs, roster);
    const deflects = res.round.deflectCounts();
    const gain = roundGain(order, deflects);
    scores = addScores(scores, gain);
    for (const [id, c] of Object.entries(deflects)) totals[id] = (totals[id] ?? 0) + c;
    if (res.round.stats.topSpeed[1] > topSpeed[1]) topSpeed = res.round.stats.topSpeed;
    if (res.round.stats.bestClash[1] > bestClash[1]) bestClash = res.round.stats.bestClash;
    log.push({ n, seconds: res.seconds, winner: res.round.winner, order, gain, maxSpeed: res.maxSpeed, outs: res.round.outs.length, worstRadius: res.worstRadius });
  }
  const rank = rankMatch(roster, scores, totals);
  return { roster, scores, totals, rank, log, problems, awards: awardsFrom({ totals, topSpeed, bestClash }), ARENA_R };
}
