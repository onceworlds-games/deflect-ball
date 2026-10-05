// Every number of the game in one place. Pure: no three.js, no DOM, no SDK.

export const STEP = 1 / 60; // fixed simulation step, seconds

// Arena and bodies
export const ARENA_R = 26; // the floating disc
export const RING_R = 18; // spawn ring
export const FALL_Y = -6; // below this a body is out
export const CHEST = 1.1; // height of a player's centre of mass (what the ball aims at)
export const BALL_R = 0.7;
export const HIT_R = 1.6; // ball centre to chest: contact
export const MOVE_SPEED = 9;
export const JUMP_V = 9;
export const GRAVITY = 26;
export const DASH_SPEED = 28;
export const DASH_TIME = 0.15;
export const DASH_CD = 4;

// Deflecting
export const WINDOW = 0.25; // seconds a press stays open
export const DEFLECT_CD = 0.9; // cooldown from a press; a successful deflect resets it
export const CONE_HALF = Math.PI / 6; // 60 degree cone around the aim
export const GRACE = 0.22; // host waits this long for a target's deflect after contact
export const LEAD = 0.3; // how far ahead (seconds of flight) a deflect may be accepted
export const CLASH_GAP = 0.6;
export const CLASH_MIN = 3; // shown from the third deflect of a back and forth
export const CLASH_KING = 10;

// The ball
export const SPEED_START = 20;
export const SPEED_STEP = 0.4; // u/s gained per deflect (a x1.06 compounding took the ball past 100 u/s in 12 s: rounds of 20 s)
export const SPEED_RAMP = 0.6; // u/s gained per second of ball time ...
export const RAMP_GROW = 0.02; // ... and the ramp itself grows with ball time (doubles after 50 s)
export const SPEED_MAX = 220;
export const SUDDEN_DEATH_S = 240; // after this a window no longer saves anybody
export const SPEED_DEMON = 120;
export const PERFECT_S = 0.1;

// Rounds
export const INTRO_S = 3;
export const HOLD_S = 0.8; // the ball waits after an elimination
export const WIN_ORBIT_MS = 1900;
export const BOARD_MS = 4000;
export const OVER_MS = WIN_ORBIT_MS + BOARD_MS;
export const FINAL_MS = 9000;
export const PLACE_POINTS = [5, 3, 2, 1];
export const DEFLECT_POINT_CAP = 5;
export const TABLE = 8; // bots fill to this many
export const MAX_PLAYERS = 12;
export const ROUND_OPTIONS = [3, 5, 7];
export const ROUND_DEFAULT = 5;

// Networking
export const SNAP_HZ_MAX = 20;
export const SNAP_HZ_MIN = 8;
export const PRESENCE_MS = 50;

export const COLORS = [
  '#2de2ff', // cyan
  '#ff4fa3', // pink
  '#ffc233', // amber
  '#8dff4d', // lime
  '#a06bff', // violet
  '#ff7a2f', // orange
  '#31ffb5', // mint
  '#4d86ff', // blue
  '#e8ff3a', // citron
  '#ff3d6e', // crimson
  '#00c2a8', // teal
  '#d6d9ff', // silver
];

export const BOT_NAMES = ['Nova', 'Echo', 'Blaze', 'Pixel', 'Rook', 'Vex', 'Kai', 'Juno', 'Orbit', 'Zed', 'Mika', 'Rio', 'Ace', 'Sol'];

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
