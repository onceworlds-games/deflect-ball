// Deflect Ball: the page. Joins the room first, then builds the world; the title shows a demo of bots playing, Play starts the music
// and goes to the lobby (the world, live: move, try the controls, a slow practice ball), and the host's rounds take it from there.
import './style.css';
import * as THREE from 'three';
import { createStage } from './scene.js';
import { CameraRig } from './camera.js';
import { Actors, BallView } from './actors.js';
import { Fx } from './fx.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createNet } from './net.js';
import { Demo } from './demo.js';
import { createStub } from './stub.js';
import { setAvatarSource } from './avatars.js';
import { colorOf, ordinal } from './match.js';
import { hashString } from './rng.js';
import { runPoster } from './poster.js';
import { STEP, CHEST, COLORS, ROUND_OPTIONS, ROUND_DEFAULT, WIN_ORBIT_MS, OVER_MS, SPEED_DEMON, CLASH_KING, clamp, num } from './config.js';

const lobbyColor = (id) => COLORS[hashString(String(id)) % COLORS.length];
const JOIN = { maxPlayers: 12, minPlayers: 1, lobby: 'bar', settings: [{ id: 'rounds', label: 'Rounds', options: ROUND_OPTIONS, default: ROUND_DEFAULT }] };
const TOUCH_CONTROLS = {
  stick: 'analog',
  buttons: [
    { id: 'deflect', label: 'Deflect', key: 'f' },
    { id: 'jump', label: 'Jump', key: ' ' },
    { id: 'dash', label: 'Dash', key: 'Shift' },
  ],
};

async function boot() {
  const hud = createHud();
  const stub = window.onceworlds ? null : createStub();
  const ow = window.onceworlds ?? stub.ow;
  try {
    ow.ui?.setOrientation?.('landscape');
  } catch {
    /* desktop ignores it */
  }

  // ---------------------------------------------------------------- join first, build after
  let room;
  try {
    room = await ow.rooms.join(JOIN);
  } catch (err) {
    console.error('[deflect-ball] join', err);
    hud.notice('CAN’T CONNECT');
    return;
  }
  try {
    room.hideLobby();
  } catch {
    /* no platform lobby around */
  }
  setAvatarSource((id) => ow.player.avatarUrl(id, 'head'));

  const canvas = document.getElementById('c');
  const touch = () => !!ow.controls?.touch;
  let stage;
  try {
    stage = createStage(canvas, { quality: ow.settings.quality, pixelRatio: ow.settings.pixelRatio(2), width: innerWidth, height: innerHeight });
  } catch (err) {
    console.error('[deflect-ball] webgl', err);
    hud.notice('3D GRAPHICS NEEDED');
    return;
  }
  const { scene, camera } = stage;
  const rig = new CameraRig(camera);
  const actors = new Actors(scene, camera);
  const ball = new BallView(scene, stage.ballLight, camera);
  const fx = new Fx(scene, camera);
  const audio = createAudio();
  const demo = new Demo((Math.random() * 1e6) | 0);

  // ---------------------------------------------------------------- settings: quality, reduced motion, size
  function layout() {
    const w = Math.max(2, innerWidth);
    const h = Math.max(2, innerHeight);
    stage.resize(w, h, ow.settings.pixelRatio(2));
    rig.setBaseFov(stage.fovFor(w / h));
    camera.fov = rig.baseFov;
    camera.updateProjectionMatrix();
  }
  function applySettings() {
    const reduced = !!ow.settings.reducedMotion;
    stage.setQuality(ow.settings.quality);
    fx.configure(ow.settings.quality, reduced);
    actors.reduced = reduced;
    actors.setShadows(ow.settings.quality !== 'low');
    ball.reduced = reduced;
    rig.reduced = reduced;
    hud.setReduced(reduced);
    layout();
  }
  applySettings();
  addEventListener('resize', layout);
  ow.settings.on('change', applySettings);

  // ---------------------------------------------------------------- what is saved
  let stats = { played: 0, wins: 0, deflects: 0, topSpeed: 0, bestClash: 0, perfect: 0 };
  Promise.resolve(ow.save.get('stats'))
    .then((s) => {
      if (s && typeof s === 'object') stats = { ...stats, ...s };
    })
    .catch(() => {});
  const awarded = new Set();
  const badge = (id) => {
    if (awarded.has(id)) return;
    awarded.add(id);
    Promise.resolve(ow.badges.award(id)).catch(() => {});
  };

  // ---------------------------------------------------------------- the page's own state
  let mode = 'title'; // 'title' until Play, then 'world'
  let net = null;
  let input = null;
  let hitStop = 0;
  let slow = 0;
  let countLast = -1;
  let flashA = 0;
  let flashColor = '#fff';
  let edgeA = 0;
  let controlsOn = null;
  let resultsUntil = 0;
  let resultsData = null;
  let closed = false;
  let meOutAt = -1e9;
  let myPerfect = false;
  let clashShown = false;
  const tmpA = { x: 0, y: 0, z: 0, r: 0, sw: 0 };
  const tmpB = { x: 0, y: 0, z: 0, r: 0, sw: 0 };
  const tmpC = { x: 0, y: 0, z: 0, r: 0, sw: 0 };
  const meDraw = { px: 0, py: 0, pz: 0, x: 0, y: 0, z: 0, have: false };
  const look = { dyaw: 0, dpitch: 0 };
  const spec = new THREE.Vector3(0, 0, 0);
  const v3 = new THREE.Vector3();

  const nameOf = (id) => {
    const r = net.rec(id);
    if (r && r.name) return r.name;
    if (id === room.me.id) return room.me.name || 'You';
    return room.players.get(id)?.name || 'Player';
  };
  const colorFor = (id) => net.rec(id)?.color ?? lobbyColor(id);

  // ---------------------------------------------------------------- the net: everything the room does for us
  function attach() {
    if (net) net.stop();
    net = createNet(room);
    input = input ?? createInput(canvas, { onPress: () => net?.press(), active: () => mode === 'world' && !!net && net.active });
    wireNet();
    wireRoom();
    if (mode === 'world') net.setActive(true);
  }

  function wireRoom() {
    room.on('starting', () => {
      countLast = -1;
    });
    room.on('matchstart', () => {
      if (mode !== 'world') return;
      hud.count('GO');
      audio.sfx.go();
    });
    room.on('matchend', (match, previous) => {
      hud.hideCount();
      hud.hideBanner();
      countLast = -1;
      // the results stay up over the lobby for a few seconds
      if (previous?.phase === 'playing' && resultsData) resultsUntil = performance.now() + 6500;
    });
    room.on('close', (reason) => {
      if (closed) return;
      const text = reason === 'kicked' ? 'YOU WERE REMOVED' : reason === 'replaced' ? 'PLAYING IN ANOTHER TAB' : reason === 'disconnected' ? 'DISCONNECTED' : '';
      if (!text) return;
      closed = true;
      hud.notice(text, reason === 'disconnected' ? 'REJOIN' : 'PLAY', async () => {
        try {
          room = await ow.rooms.join(JOIN);
          closed = false;
          hud.hideNotice();
          attach();
          if (mode === 'title') room.hideLobby();
        } catch (err) {
          console.error('[deflect-ball] rejoin', err);
        }
      });
    });
  }

  function wireNet() {
    net.on('round', ({ n, total }) => {
      hud.clearClash();
      fx.clear();
      ball.clearTrail();
      hitStop = 0;
      slow = 0;
      if (net.body) {
        rig.setYaw(net.body.yaw);
        rig.pitch = 0.12;
        rig.cut();
      }
      meDraw.have = false;
      hud.banner(`ROUND ${n}`, n === total ? 'FINAL ROUND' : 'LAST ONE STANDING');
      audio.sfx.tick();
    });
    net.on('play', () => {
      audio.sfx.launch();
      fx.launch(0, 1.6, 0, '#2de2ff');
      rig.addTrauma(0.25);
    });
    net.on('press', ({ ok }) => {
      if (ok) audio.sfx.swing();
      else audio.sfx.refuse();
    });
    net.on('deflect', onDeflect);
    net.on('mydeflect', ({ perfect, speed }) => {
      if (net.phase !== 'play') return;
      myPerfect = !!perfect;
      stats.deflects++;
      stats.topSpeed = Math.max(stats.topSpeed, Math.round(speed));
      if (perfect) {
        stats.perfect++;
        badge('perfect');
      }
      if (speed > SPEED_DEMON) badge('speed-demon');
      if (net.clashNow() < 3) hud.callout(perfect ? 'PERFECT' : 'DEFLECTED', speed > 100 ? `${Math.round(speed)}` : '', perfect ? 'gold' : 'good');
    });
    net.on('myimpact', () => {
      audio.sfx.thud();
      rig.addTrauma(0.35);
      flash('#ff2b3f', 0.25);
    });
    net.on('out', onOut);
    net.on('clash', ({ n, a, b }) => {
      audio.sfx.clash(n);
      const pa = net.pose(a, tmpA);
      const pb = net.pose(b, tmpB);
      const proj = projectMid(pa, pb);
      hud.clash(`CLASH ×${n}`, proj.x, proj.y);
      clashShown = true;
      if (n >= 6) rig.addTrauma(0.08);
    });
    net.on('clashwon', ({ id, n }) => {
      if (id !== room.me.id) return;
      stats.bestClash = Math.max(stats.bestClash, n);
      if (n >= CLASH_KING) badge('clash-king');
      hud.callout('CLASH WON', `×${n}`, 'gold');
      audio.sfx.win();
    });
    net.on('over', ({ g }) => {
      hud.clearClash();
      const win = g.win;
      if (typeof win !== 'string') return;
      hud.banner('WINNER', nameOf(win).toUpperCase());
      if (win === room.me.id) audio.sfx.win();
      const p = net.pose(win, tmpA);
      if (p) fx.celebrate(p.x, p.z, 120);
      if (!ow.settings.reducedMotion) slow = WIN_ORBIT_MS / 1000 - 0.1; // the winner, in slow motion
    });
    net.on('final', onFinal);
    net.on('practice', onPractice);
    net.on('phase', ({ phase, prev }) => {
      if (phase === 'lobby' && prev !== 'lobby' && prev !== 'starting' && net.body) {
        rig.setYaw(net.body.yaw);
        rig.cut();
        meDraw.have = false;
        fx.clear();
        ball.clearTrail();
      }
    });
  }

  // ---------------------------------------------------------------- the moments
  function onDeflect({ by, to, speed }) {
    const pa = net.pose(by, tmpA);
    const pb = net.pose(to, tmpB);
    if (!pa) return;
    const power = clamp(speed / 150, 0.12, 1);
    let dx = 0;
    let dy = 0;
    let dz = 1;
    if (pb) {
      dx = pb.x - pa.x;
      dy = pb.y - pa.y;
      dz = pb.z - pa.z;
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l;
      dy /= l;
      dz /= l;
    }
    const mine = by === room.me.id;
    const toMe = to === room.me.id;
    fx.deflect(pa.x + dx * 0.8, pa.y + CHEST + 0.2, pa.z + dz * 0.8, dx, dy, dz, colorFor(by), power);
    ball.doFlare();
    audio.sfx.deflect(power, mine && myPerfect);
    if (mine) {
      myPerfect = false;
      rig.addTrauma(0.22 + power * 0.3);
      rig.kick(3 + power * 3);
      if (!ow.settings.reducedMotion) {
        hitStop = 0.06;
        flash('#ffffff', 0.16);
      }
    } else if (toMe) rig.addTrauma(0.12);
    else rig.addTrauma(0.05 + power * 0.06);
    if (speed > 90 && (mine || toMe) && !ow.settings.reducedMotion) slow = 0.15;
  }

  function onOut({ id, at, me }) {
    const p = at ?? net.pose(id, tmpA);
    const col = colorFor(id);
    if (p) fx.shatter(p.x, Math.max(0, p.y), p.z, col);
    audio.sfx.hit(true);
    rig.addTrauma(me ? 0.8 : 0.28);
    if (me) {
      meOutAt = performance.now();
      const g = net.g;
      const at = g ? g.out.indexOf(id) : -1;
      const place = at >= 0 ? net.roster.length - at : 0;
      hud.callout('ELIMINATED', place > 0 ? ordinal(place) : '', 'bad');
      flash('#ff2b3f', 0.4);
      if (!ow.settings.reducedMotion) hitStop = 0.08;
      audio.sfx.lose();
    } else if (performance.now() - meOutAt > 1800) {
      hud.callout(`${nameOf(id).toUpperCase()} OUT`, '', 'bad small');
    }
  }

  function onFinal({ g, roster }) {
    const me = room.me.id;
    const rank = Array.isArray(g.fr) ? g.fr : [];
    const byId = new Map(roster.map((r) => [r.id, r]));
    const nm = (id) => {
      const r = byId.get(id);
      return r?.name ?? room.players.get(id)?.name ?? (id === me ? room.me.name : 'Player');
    };
    const podium = rank.slice(0, 3).map((id) => ({ id, name: nm(id).toUpperCase(), total: g.scores?.[id] ?? 0, color: byId.get(id)?.color ?? lobbyColor(id) }));
    const idx = rank.indexOf(me);
    const youPlace = idx >= 0 ? idx + 1 : 0;
    const awards = [];
    const aw = g.aw ?? {};
    if (aw.most) awards.push({ label: 'MOST DEFLECTS', text: `${nm(aw.most[0]).toUpperCase()} ${aw.most[1]}` });
    if (aw.speed) awards.push({ label: 'TOP SPEED', text: `${nm(aw.speed[0]).toUpperCase()} ${Math.round(aw.speed[1])}` });
    if (aw.clash) awards.push({ label: 'BEST CLASH', text: `${nm(aw.clash[0]).toUpperCase()} ×${aw.clash[1]}` });
    resultsData = { podium, youPlace, awards };
    resultsUntil = 0; // shown during the final phase, then for a few seconds over the lobby
    if (youPlace === 1) audio.sfx.win();
    else if (youPlace > 0) audio.sfx.nice(1);
    const w = podium[0] && net.pose(podium[0].id, tmpA);
    if (w) fx.celebrate(w.x, w.z, 200);
    if (youPlace > 0) {
      stats.played++;
      if (youPlace === 1) {
        stats.wins++;
        badge('first-win');
        Promise.resolve(ow.leaderboards.submit('wins', stats.wins)).catch(() => {});
      }
      Promise.resolve(ow.save.set('stats', stats)).catch(() => {});
    }
  }

  function onPractice(e) {
    if (e.type === 'deflect') {
      const me = net.pose(room.me.id, tmpA);
      if (me) fx.deflect(me.x, me.y + CHEST + 0.2, me.z, 0, 0.2, 1, colorFor(room.me.id), 0.3);
      ball.doFlare();
      audio.sfx.deflect(0.25, e.perfect);
      audio.sfx.nice(e.streak);
      rig.addTrauma(0.15);
      hud.callout(e.perfect ? 'PERFECT' : 'NICE', e.streak > 1 ? `×${e.streak}` : '', e.perfect ? 'gold small' : 'good small');
    } else if (e.type === 'miss') {
      audio.sfx.thud();
      rig.addTrauma(0.12);
      hud.callout('MISS', '', 'bad small');
    } else if (e.type === 'spawn') audio.sfx.spawn();
  }

  function flash(color, a) {
    if (ow.settings.reducedMotion) return;
    flashColor = color;
    flashA = Math.max(flashA, a);
  }

  /** The screen position between two players' heads (where "CLASH" goes). */
  function projectMid(a, b) {
    const w = innerWidth;
    const h = innerHeight;
    if (!a || !b) return { x: w / 2, y: h * 0.4 };
    v3.set((a.x + b.x) / 2, (a.y + b.y) / 2 + 3, (a.z + b.z) / 2).project(camera);
    if (v3.z > 1 || Math.abs(v3.x) > 1.1 || Math.abs(v3.y) > 1.1) return { x: w / 2, y: h * 0.4 };
    return { x: clamp((v3.x * 0.5 + 0.5) * w, 90, w - 90), y: clamp((-v3.y * 0.5 + 0.5) * h, 90, h - 90) };
  }

  // ---------------------------------------------------------------- Play
  function play() {
    if (mode !== 'title' || closed) return;
    mode = 'world';
    audio.start();
    audio.sfx.tick();
    hud.title(false);
    input.clearQueue();
    try {
      room.hideLobby(false);
    } catch {
      /* fine */
    }
    actors.clearExcept(new Set());
    fx.clear();
    ball.clearTrail();
    net.setActive(true);
    if (net.body) rig.setYaw(net.body.yaw);
    rig.pitch = 0.12;
    rig.cut();
    meDraw.have = false;
  }
  hud.onPlay(play);
  addEventListener('keydown', (e) => {
    if (mode === 'title' && (e.code === 'Space' || e.code === 'Enter') && !e.repeat) {
      e.preventDefault();
      play();
    } else if (stub && mode === 'world' && e.code === 'Enter' && room.match.phase === 'lobby') room.startMatch();
  });
  hud.onStubStart(() => room.startMatch());
  hud.onSetting((dir) => {
    if (!room.isHost || room.match.phase !== 'lobby') return;
    const cur = num(room.settings.rounds, ROUND_DEFAULT);
    const i = clamp(ROUND_OPTIONS.indexOf(cur) + dir, 0, ROUND_OPTIONS.length - 1);
    room.setSetting('rounds', ROUND_OPTIONS[i]);
    audio.sfx.tick();
  });

  attach();
  hud.playReady(true);

  // ---------------------------------------------------------------- per frame: the title's demo
  const demoSeen = { n: 0 };
  function titleFrame(dt) {
    demo.step(dt);
    const r = demo.round;
    if (demoSeen.n !== demo.n) {
      demoSeen.n = demo.n;
      fx.clear();
      ball.clearTrail();
    }
    const keep = new Set();
    for (const p of r.list) {
      const rec = demo.roster[p.idx];
      keep.add(p.id);
      actors.ensure(p.id, { name: rec.name, color: colorOf(p.idx), bot: true });
      tmpA.x = p.body.x;
      tmpA.y = p.body.y;
      tmpA.z = p.body.z;
      tmpA.r = p.body.yaw;
      tmpA.sw = p.def.presses;
      actors.update(p.id, tmpA, dt, { show: p.alive, tag: false });
    }
    actors.clearExcept(keep);
    for (const e of demo.events) {
      if (e.type === 'deflect') {
        const a = r.players.get(e.by);
        const b = r.players.get(e.to);
        if (a && b) {
          const dx = b.body.x - a.body.x;
          const dz = b.body.z - a.body.z;
          const l = Math.hypot(dx, dz) || 1;
          fx.deflect(a.body.x, a.body.y + CHEST + 0.2, a.body.z, dx / l, 0, dz / l, colorOf(a.idx), clamp(e.speed / 150, 0.15, 1));
          ball.doFlare();
        }
      } else if (e.type === 'out') {
        const p = r.players.get(e.id);
        if (p) fx.shatter(e.x, Math.max(0, e.y), e.z, colorOf(p.idx));
      } else if (e.type === 'play') fx.launch(0, 1.6, 0, '#2de2ff');
    }
    demo.events.length = 0;
    const b = r.ball;
    const tgt = b.target ? r.players.get(b.target) : null;
    const charge = r.phase === 'intro' ? clamp(r.t / r.introS, 0, 1) : 0;
    ballState.active = b.active;
    ballState.charge = charge;
    ballState.x = charge > 0 ? 0 : b.x;
    ballState.y = charge > 0 ? 1.6 : b.y;
    ballState.z = charge > 0 ? 0 : b.z;
    ballState.speed = b.speed;
    ballState.color = tgt ? colorOf(tgt.idx) : '#2de2ff';
    ballState.target = tgt ? targetPoint.set(tgt.body.x, tgt.body.y + CHEST, tgt.body.z) : null;
    actors.setTarget(null);
    actors.setAimMark(null);
    // the camera drifts round the arena
    rig.orbit(dt, 0, -1.5, 0, 31, 12, 0.07);
  }

  // ---------------------------------------------------------------- per frame: the world
  const ballState = { active: false, charge: 0, x: 0, y: 0, z: 0, speed: 0, color: '#2de2ff', target: null };
  const targetPoint = new THREE.Vector3();
  const moveIn = { x: 0, z: 0 };

  function moveVector() {
    const k = input.move();
    const s = ow.controls?.stick ?? { x: 0, y: 0 };
    let x = k.x + num(s.x);
    let y = k.y - num(s.y);
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    const sy = Math.sin(rig.yaw);
    const cy = Math.cos(rig.yaw);
    moveIn.x = sy * y - cy * x;
    moveIn.z = cy * y + sy * x;
    return moveIn;
  }

  let acc = 0;
  function stepWorld(dt) {
    acc += dt;
    let first = true;
    let steps = 0;
    while (acc >= STEP && steps < 5) {
      if (net.body) {
        meDraw.px = net.body.x;
        meDraw.py = net.body.y;
        meDraw.pz = net.body.z;
        if (!meDraw.have) {
          meDraw.have = true;
        }
      }
      const mv = moveVector();
      net.step(STEP, { mx: mv.x, mz: mv.z, jump: first && input.takeJump(), dash: first && input.takeDash(), face: rig.yaw, aim: rig.yaw });
      first = false;
      acc -= STEP;
      steps++;
    }
    if (steps === 5) acc = 0;
    const b = net.body;
    if (b) {
      const a = acc / STEP;
      let px = meDraw.px;
      let py = meDraw.py;
      let pz = meDraw.pz;
      if (!meDraw.have || Math.hypot(b.x - px, b.z - pz) > 4 || Math.abs(b.y - py) > 4) {
        px = b.x;
        py = b.y;
        pz = b.z;
        meDraw.have = true;
      }
      meDraw.x = px + (b.x - px) * a;
      meDraw.y = py + (b.y - py) * a;
      meDraw.z = pz + (b.z - pz) * a;
    }
    const f = net.takeFlags();
    if (f.jumped) audio.sfx.jump();
    if (f.landed) {
      audio.sfx.land();
      if (b) fx.dust(b.x, b.y, b.z, 5);
    }
    if (f.dashed) {
      audio.sfx.dash();
      if (b) fx.dust(b.x, b.y, b.z, 9);
    }
  }

  function syncControls(ph) {
    const want = net.active && !room.spectating && (ph === 'lobby' || ph === 'starting' || ((ph === 'intro' || ph === 'play') && net.inRoster && net.alive));
    if (want === controlsOn) return;
    controlsOn = want;
    try {
      ow.controls.set(want ? TOUCH_CONTROLS : null);
    } catch {
      /* no controls here */
    }
  }

  function worldFrame(dt, vdt) {
    const ph = net.phase;
    const g = net.g;
    syncControls(ph);
    const lockWanted = !touch() && net.active && !room.spectating && net.inRoster && net.alive && (ph === 'intro' || ph === 'play' || ph === 'over');
    input.setWantLock(lockWanted);
    input.takeLook(look);
    rig.turn(look.dyaw, look.dpitch);
    stepWorld(dt);
    net.frame(dt);

    const me = room.me.id;
    const inMatch = ph === 'intro' || ph === 'play' || ph === 'over' || ph === 'final' || ph === 'wait';
    const matchNow = room.matchNow();
    const meIn = net.inRoster;

    // ---- the people
    const ids = new Set();
    if (inMatch) {
      for (const r of net.roster) ids.add(r.id);
    } else {
      if (net.body && net.active) ids.add(me);
      for (const p of room.online) {
        if (p.id !== me && (p.presence || net.pose(p.id, tmpA))) ids.add(p.id);
      }
    }
    for (const id of ids) {
      const isMe = id === me;
      actors.ensure(id, { name: nameOf(id), color: colorFor(id), bot: !!net.rec(id)?.bot });
      let pose = net.pose(id, tmpA);
      if (isMe && pose && meDraw.have) {
        pose.x = meDraw.x;
        pose.y = meDraw.y;
        pose.z = meDraw.z;
      }
      const out = inMatch && net.isOut(id);
      const ready = !inMatch && !!room.players.get(id)?.ready;
      actors.update(id, pose, vdt, { show: !out, me: isMe, ready, arrow: isMe && ph === 'intro', tag: true });
    }
    actors.clearExcept(ids);

    // ---- the ball
    const b = net.ballView();
    const off = net.ballOffset;
    let target = null;
    let targetPose = null;
    if (b.target) {
      targetPose = net.pose(b.target, tmpB);
      if (b.target === me && meDraw.have && targetPose) {
        targetPose.x = meDraw.x;
        targetPose.y = meDraw.y;
        targetPose.z = meDraw.z;
      }
      if (targetPose) target = targetPoint.set(targetPose.x, targetPose.y + CHEST, targetPose.z);
    }
    let charge = 0;
    if (ph === 'intro' && g && num(g.until) > 0) charge = clamp(1 - (g.until - matchNow) / 1000, 0, 1);
    const live = !!b.active && (ph === 'play' || ph === 'lobby');
    ballState.active = live;
    ballState.charge = charge;
    ballState.x = charge > 0 && !live ? 0 : b.x + (live ? off.ex : 0);
    ballState.y = charge > 0 && !live ? 1.6 : b.y + (live ? off.ey : 0);
    ballState.z = charge > 0 && !live ? 0 : b.z + (live ? off.ez : 0);
    ballState.speed = b.speed;
    ballState.color = colorFor(b.target && b.target !== 'dummy' ? b.target : (b.by ?? me));
    ballState.target = live && b.target !== me ? target : null;
    actors.setTarget(live && b.target ? b.target : null, targetPose, b.target === me);
    // while the ball is mine: who it would go to, if I deflected now
    let aimPose = null;
    if (live && b.target === me && ph === 'play') {
      const pick = net.aimPick();
      if (pick) aimPose = net.pose(pick, tmpC);
    }
    actors.setAimMark(aimPose);

    // ---- when the ball is mine: the edge, the alarm
    let tti = Infinity;
    let dist = 99;
    const mine = live && b.target === me && !b.pend && net.body && (ph === 'lobby' || (net.alive && meIn));
    if (mine) {
      dist = Math.hypot(ballState.x - meDraw.x, ballState.y - (meDraw.y + CHEST), ballState.z - meDraw.z);
      tti = Math.max(0, dist - 1.6) / Math.max(1, b.speed);
      const urgency = clamp(1 - tti / 1.8, 0.18, 1);
      const wob = ow.settings.reducedMotion ? 0.7 : 0.55 + 0.45 * Math.sin(performance.now() * 0.001 * (6 + 16 * urgency));
      edgeA += (urgency * wob - edgeA) * Math.min(1, dt * 16);
      audio.alarm(dist, tti, performance.now() / 1000);
    } else edgeA += (0 - edgeA) * Math.min(1, dt * 8);
    hud.edge(edgeA);
    audio.setHum(live, b.speed);

    // ---- the arrow to the ball when it is off screen
    let arrowOn = false;
    if (live && !(b.target === me && mine && tti < 0.12)) {
      v3.set(ballState.x, ballState.y, ballState.z).project(camera);
      const behind = v3.z > 1;
      let nx = v3.x;
      let ny = v3.y;
      if (behind) {
        nx = -nx;
        ny = -ny;
      }
      if (behind || Math.abs(nx) > 0.96 || Math.abs(ny) > 0.94) {
        const w = innerWidth;
        const h = innerHeight;
        const mx = 44;
        const my = 44;
        let dx = nx * (w / 2);
        let dy = -ny * (h / 2);
        if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dy = -1;
        const k = 1 / Math.max(Math.abs(dx) / (w / 2 - mx), Math.abs(dy) / (h / 2 - my));
        let ax = w / 2 + dx * k;
        let ay = h / 2 + dy * k;
        // keep clear of the platform's buttons (top left) and the thumbs (bottom corners)
        if (ax < 150 && ay < 74) ax = 150;
        if (ay > h - 120 && (ax < 120 || ax > w - 120)) ay = h - 120;
        hud.arrow(true, ax, ay, (Math.atan2(dx, -dy) * 180) / Math.PI, ballState.color);
        arrowOn = true;
      }
    }
    if (!arrowOn) hud.arrow(false, 0, 0, 0, '#fff');

    // ---- the edge of the world warns you
    const nearEdge = net.active && net.body && !room.spectating && (ph === 'lobby' || ph === 'starting' || ((ph === 'intro' || ph === 'play') && meIn && net.alive));
    stage.setRimWarning(nearEdge ? (Math.hypot(net.body.x, net.body.z) - 20.5) / 5 : 0);

    // ---- the camera
    const canFollow = net.active && net.body && !room.spectating && (ph === 'lobby' || ph === 'starting' || ((ph === 'intro' || ph === 'play') && meIn && net.alive));
    const overT = g && ph === 'over' ? matchNow - (num(g.until) - OVER_MS) : -1;
    if (canFollow) {
      if (meDraw.have) rig.follow(meDraw.x, meDraw.y, meDraw.z);
      else rig.follow(net.body.x, net.body.y, net.body.z);
    } else if (ph === 'over' && g && typeof g.win === 'string' && overT < WIN_ORBIT_MS) {
      const wp = net.pose(g.win, tmpC);
      if (wp) rig.orbit(vdt, wp.x, wp.y, wp.z, 7.5, 2.6, 0.5);
      else rig.orbit(vdt, 0, 0, 0, 36, 16, 0.1);
    } else {
      const cx = live ? ballState.x * 0.5 : 0;
      const cz = live ? ballState.z * 0.5 : 0;
      spec.x += (cx - spec.x) * Math.min(1, dt * 2);
      spec.z += (cz - spec.z) * Math.min(1, dt * 2);
      rig.orbit(vdt, spec.x, 0, spec.z, 37, 16, 0.1);
    }

    // ---- the countdown
    if (ph === 'starting') {
      const at = room.match.startsAt;
      if (typeof at === 'number') {
        const n = Math.ceil((at - ow.now()) / 1000);
        if (n >= 1 && n <= 3 && n !== countLast) {
          countLast = n;
          hud.count(n);
          audio.sfx.count(n);
        }
      }
    }
    // the charge-up of the ball's sound, once, a second before it appears
    if (ph === 'intro' && g && num(g.until) > 0 && g.until - matchNow < 1000 && chargeSound !== g.rid) {
      chargeSound = g.rid;
      audio.sfx.charge();
      fx.charge(0, 1.6, 0, '#2de2ff');
    }

    // ---- a clash label goes when the back and forth does
    if (clashShown && net.clashNow() < 3) {
      hud.clearClash();
      clashShown = false;
    }

    // ---- the heads-up display
    updateHud(ph, g, b, live, matchNow, mine ? tti : Infinity);

    // ---- the music
    const tense = live && (b.speed > 90 || (g && net.roster.length - g.out.length <= 3));
    let level = 1;
    if (ph === 'intro' || ph === 'play') level = tense ? 3 : 2;
    else if (ph === 'lobby' || ph === 'starting') level = 1;
    audio.setMusic(level, ow.settings.quality);
  }
  let chargeSound = '';

  function updateHud(ph, g, b, live, matchNow, approach) {
    const me = room.me.id;
    const inRound = (ph === 'intro' || ph === 'play' || ph === 'over') && !!g;
    const total = g ? g.rounds : ROUND_DEFAULT;
    const alive = g ? Math.max(0, net.roster.length - (Array.isArray(g.out) ? g.out.length : 0)) : 0;
    hud.top(inRound, g ? g.n : 0, total, alive, live ? b.speed : 0);
    const meIn = net.inRoster;
    let status = 'ALIVE';
    let kind = 'alive';
    if (room.spectating || (inRound && !meIn)) {
      status = 'WATCHING';
      kind = 'watch';
    } else if (inRound && !net.alive) {
      status = 'OUT';
      kind = 'out';
    }
    const pts = g && meIn ? num(g.scores?.[me]) + Math.min(5, num(g.dc?.[me])) : 0;
    hud.me(inRound && meIn, pts, status, kind);
    hud.watch(room.spectating ? 'WATCHING' : '');
    const playingNow = (ph === 'play' || ph === 'intro') && meIn && net.alive && net.active;
    const df = net.deflector();
    hud.reticle(playingNow || ((ph === 'lobby' || ph === 'starting') && net.active), df.frac, df.open, approach);
    hud.esc(input.locked);
    hud.aimHint(input.wantLock && !input.locked && !input.lockBroken && !touch());

    // the lobby
    const showLobby = (ph === 'lobby' || ph === 'starting') && net.active;
    const resultsShowing = resultsData && (ph === 'final' || performance.now() < resultsUntil);
    hud.lobby(showLobby, {
      rounds: num(room.settings.rounds, ROUND_DEFAULT),
      host: room.isHost && ph === 'lobby',
      hint: !resultsShowing,
      hintText: 'DEFLECT THE BALL',
      hintKey: touch() ? '' : 'CLICK',
      stub: !!stub && ph === 'lobby',
    });

    // the round's scores
    if (ph === 'over' && g && matchNow - (num(g.until) - OVER_MS) >= WIN_ORBIT_MS) {
      const rows = net.roster
        .map((r, i) => ({ id: r.id, name: nameOf(r.id).toUpperCase(), color: r.color, total: num(g.scores?.[r.id]), gain: num(g.gain?.[r.id]), me: r.id === me, win: r.id === g.win, i }))
        .sort((a, c) => c.total - a.total || a.i - c.i);
      hud.board(true, `ROUND ${g.n}`, rows);
    } else hud.board(false);

    // the match's results (also over the lobby for a few seconds)
    if (resultsData && (ph === 'final' || performance.now() < resultsUntil)) hud.results(true, resultsData);
    else hud.results(false);
    if (ph === 'starting' || ph === 'intro') resultsUntil = 0;
  }

  // ---------------------------------------------------------------- the loop
  let last = performance.now();
  let errors = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = clamp((now - last) / 1000, 0, 0.1);
    last = now;
    try {
      let vdt = dt;
      if (!ow.settings.reducedMotion) {
        if (hitStop > 0) {
          hitStop -= dt;
          vdt = 0;
        } else if (slow > 0) {
          slow -= dt;
          vdt = dt * 0.35;
        }
      } else {
        hitStop = 0;
        slow = 0;
      }
      if (mode === 'title') titleFrame(dt);
      else if (!closed) worldFrame(dt, vdt);
      else input.setWantLock(false);
      // flashes fade quickly
      flashA = Math.max(0, flashA - dt * 3.2);
      hud.flash(flashA, flashColor);
      actors.tick(vdt);
      ball.update(vdt, ballState);
      fx.update(vdt);
      rig.apply(vdt);
      stage.update(vdt, now / 1000);
      stage.render(vdt);
    } catch (err) {
      if (errors++ < 5) console.error('[deflect-ball] frame', err);
    }
  }

  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- go (last, so everything above is defined)
const posterName = new URLSearchParams(location.search).get('poster');
if (posterName) runPoster(posterName).catch((err) => console.error('[deflect-ball] poster', err));
else boot().catch((err) => console.error('[deflect-ball] boot', err));
