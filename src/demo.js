// The title screen's world: eight bots playing quick rounds forever, so the first thing a player sees is the game itself. Pure.
import { Round } from './round.js';
import { buildRoster, spawnSlots } from './match.js';
import { mulberry32 } from './rng.js';
import { STEP } from './config.js';

export class Demo {
  constructor(seed = 7) {
    this.rng = mulberry32(seed);
    this.seed = seed;
    this.brains = new Map();
    this.n = 0;
    this.pause = 0;
    this.events = [];
    this.roster = buildRoster([], seed).map((r) => ({ ...r }));
    this.round = null;
    this.acc = 0;
    this.next();
  }

  next() {
    this.n++;
    const rid = `demo.${this.n}`;
    this.round = new Round({
      rid,
      roster: this.roster,
      slots: spawnSlots(this.roster.length, rid),
      seed: Math.floor(this.rng() * 2 ** 32),
      brains: this.brains,
      speedStart: 38,
      rampScale: 5,
      introS: 1.2,
    });
    this.events.push({ type: 'round', rid });
  }

  /** Advance by real seconds; events (from the round) pile up in this.events for the caller to play and clear. */
  step(dt) {
    this.acc += Math.min(0.1, dt);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      if (this.round.over) {
        this.pause -= STEP;
        if (this.pause <= 0) this.next();
        continue;
      }
      this.round.step(STEP);
      for (const e of this.round.drain()) {
        this.events.push(e);
        if (e.type === 'done') this.pause = 3.2;
      }
    }
  }
}
