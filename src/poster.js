// Store art. `?poster=cover|action|win|icon|badge-<id>`: no room, no SDK, no HUD. One staged, frozen frame drawn with the real
// renderer (fixed seed), kept on screen; document.body.dataset.ready = '1' when it is there. The cover's title is drawn into the
// canvas itself, so a capture of the canvas has it too.
import * as THREE from 'three';
import { createStage, radialTexture } from './scene.js';
import { Actors, BallView } from './actors.js';
import { Fx } from './fx.js';
import { layout, POSTER_SIZES } from './posterlayout.js';
import { mulberry32 } from './rng.js';

const BADGES = {
  'first-win': { disc: ['#ffd25a', '#e39a14'], draw: trophy },
  perfect: { disc: ['#46ebff', '#1493b5'], draw: crosshair },
  'clash-king': { disc: ['#b58cff', '#6b3ed1'], draw: blades },
  'speed-demon': { disc: ['#ff9440', '#d6371f'], draw: lightningBall },
};

export async function runPoster(name) {
  Math.random = mulberry32(20261004); // every random thing in the picture is the same each time
  document.body.dataset.poster = name;
  const ui = document.getElementById('ui');
  if (ui) ui.style.display = 'none';
  const canvas = document.getElementById('c');
  const badge = name.startsWith('badge-') ? name.slice(6) : null;
  const [W, H] = badge ? [256, 256] : (POSTER_SIZES[name] ?? POSTER_SIZES.cover);
  canvas.style.cssText = `position:fixed;left:0;top:0;width:${W}px;height:${H}px;display:block`;
  document.body.style.background = '#05060f';
  try {
    await document.fonts.load('700 120px "Chakra Petch"');
    await document.fonts.load('italic 700 120px "Chakra Petch"');
    await document.fonts.ready;
  } catch {
    /* the fallback font will do */
  }
  if (badge) {
    drawBadge(canvas, W, badge);
    await frames(2);
    document.body.dataset.ready = '1';
    return;
  }

  const L = layout(name in POSTER_SIZES ? name : 'cover');
  const stage = createStage(canvas, { poster: true, quality: 'high', pixelRatio: 1, width: W, height: H });
  const { scene, camera } = stage;
  camera.fov = L.fov;
  camera.aspect = W / H;
  camera.position.set(...L.cam);
  camera.lookAt(new THREE.Vector3(...L.look));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  const fx = new Fx(scene, camera);
  fx.configure('high', false);
  const actors = new Actors(scene, camera);
  const ball = new BallView(scene, stage.ballLight, camera);

  // the cast
  L.people.forEach((p, i) => {
    if (L.hidden?.includes(i)) return;
    actors.ensure(p.id, { name: p.name, color: p.color });
    const pose = { x: p.x, y: p.y, z: p.z, r: p.yaw, sw: 0 };
    for (let k = 0; k < 90; k++) actors.update(p.id, pose, 1 / 60, { show: true, tag: false });
    if (p.swing !== null) {
      const rec = actors.get(p.id);
      rec.swingT = p.swing;
      actors.animateSwing(rec, 0);
    }
  });
  if (L.targetIndex !== undefined) {
    const t = L.people[L.targetIndex];
    actors.setTarget(t.id, { x: t.x, y: 0, z: t.z }, true); // the ring only: the cover's only text is its title
  }

  // the ball and its trail
  if (L.ball) {
    const b = L.ball;
    ball.col.set(b.color);
    ball.target.set(b.color);
    ball.flare = b.flare ?? 0;
    ball.group.scale.setScalar(b.scale ?? 1);
    const n = ball.N;
    for (let i = 0; i < n; i++) {
      const p = b.points[Math.min(i, b.points.length - 1)] ?? b.pos;
      ball.pts[i * 3] = p[0];
      ball.pts[i * 3 + 1] = p[1];
      ball.pts[i * 3 + 2] = p[2];
    }
    ball.have = 1;
    ball.lastX = b.pos[0];
    ball.lastY = b.pos[1];
    ball.lastZ = b.pos[2];
    const st = { active: true, charge: 0, x: b.pos[0], y: b.pos[1], z: b.pos[2], speed: 150, color: b.color, target: null };
    // update() shifts the trail by one point: that is fine, but keep the scale it sets
    ball.update(0, st);
    ball.group.scale.setScalar((b.scale ?? 1) * 1);
    ball.flare = b.flare ?? 0;
  }

  // the effects, aged to the moment
  for (const r of L.rings ?? []) {
    fx.rings.spawn(r.pos[0], r.pos[1], r.pos[2], r.color, { r0: 0.8, r1: r.r1, life: 0.6, mode: r.mode, gain: 2 });
    fx.rings.update(r.age ?? 0.1, camera);
  }
  for (const s of L.sparks ?? []) {
    fx.deflect(s.pos[0], s.pos[1], s.pos[2], s.dir[0], s.dir[1], s.dir[2], s.color, s.power ?? 0.8);
  }
  for (let i = 0; i < 6; i++) fx.sparks.update(0.02);
  for (const s of L.shards ?? []) fx.shards.burst(s.x, s.y, s.z, s.color, 14, 1.1, 6);
  if (L.shards) for (let i = 0; i < 18; i++) fx.shards.update(0.02);
  if (L.confetti) {
    fx.celebrate(L.confetti.x, L.confetti.z, L.confetti.n);
    for (let i = 0; i < 40; i++) fx.confetti.update(L.confetti.age / 40);
  }
  if (L.arc) addArc(scene, camera, L.arc);

  // the cover's title
  let overlay = null;
  if (name === 'cover') overlay = titleOverlay(W, H);

  stage.update(0, 0);
  const render = () => {
    requestAnimationFrame(render);
    stage.render(0);
    if (overlay) {
      const r = stage.renderer;
      r.autoClear = false;
      r.render(overlay.scene, overlay.camera);
      r.autoClear = true;
    }
  };
  render();
  await frames(3);
  document.body.dataset.ready = '1';
}

const frames = (n) =>
  new Promise((resolve) => {
    const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
    step();
  });

/** A bright crescent for the icon: the blade arc the ball is hitting. */
function addArc(scene, camera, a) {
  const geo = new THREE.RingGeometry(a.radius * 0.82, a.radius, 64, 1, a.from, a.to - a.from);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.4, 2.6), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
  );
  mesh.position.set(...a.center);
  mesh.quaternion.copy(camera.quaternion);
  scene.add(mesh);
  const glow = new THREE.Mesh(
    new THREE.RingGeometry(a.radius * 0.7, a.radius * 1.12, 64, 1, a.from, a.to - a.from),
    new THREE.MeshBasicMaterial({ map: radialTexture(32), color: new THREE.Color(0.2, 0.9, 1.3), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
  );
  glow.position.copy(mesh.position);
  glow.quaternion.copy(mesh.quaternion);
  glow.position.addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion), -0.05);
  scene.add(glow);
}

/** "DEFLECT BALL" across the top third, drawn as a texture on a screen-sized plane. */
function titleOverlay(W, H) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'italic 700 150px "Chakra Petch", "Rubik", sans-serif';
  g.save();
  g.translate(W / 2, H * 0.17);
  g.transform(1, 0, -0.12, 1, 0, 0);
  const wA = g.measureText('DEFLECT').width;
  const wB = g.measureText('BALL').width;
  const gap = 36;
  const x0 = -(wA + gap + wB) / 2;
  g.textAlign = 'left';
  g.lineJoin = 'round';
  g.shadowColor = 'rgba(45,226,255,0.8)';
  g.shadowBlur = 34;
  g.lineWidth = 16;
  g.strokeStyle = 'rgba(4,10,24,0.92)';
  g.strokeText('DEFLECT', x0, 0);
  g.strokeText('BALL', x0 + wA + gap, 0);
  g.shadowBlur = 0;
  g.fillStyle = '#ffffff';
  g.fillText('DEFLECT', x0, 0);
  g.fillStyle = '#2de2ff';
  g.fillText('BALL', x0 + wA + gap, 0);
  g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, 0, 10);
  camera.position.z = 5;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
  scene.add(plane);
  return { scene, camera };
}

// ---------------------------------------------------------------- badges: a bold symbol on a coloured disc
function drawBadge(canvas, size, id) {
  const def = BADGES[id] ?? BADGES['first-win'];
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, size, size);
  const c = size / 2;
  const R = size * 0.46;
  const grad = g.createLinearGradient(0, c - R, 0, c + R);
  grad.addColorStop(0, def.disc[0]);
  grad.addColorStop(1, def.disc[1]);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath();
  g.arc(c, c + size * 0.018, R, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = grad;
  g.beginPath();
  g.arc(c, c, R, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = size * 0.028;
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.beginPath();
  g.arc(c, c, R - size * 0.014, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = size * 0.012;
  g.strokeStyle = 'rgba(8,10,22,0.35)';
  g.beginPath();
  g.arc(c, c, R - size * 0.05, 0, Math.PI * 2);
  g.stroke();
  g.save();
  g.translate(c, c);
  g.scale(size / 256, size / 256);
  def.draw(g);
  g.restore();
}

const INK = '#0a1024';

function trophy(g) {
  g.fillStyle = INK;
  g.strokeStyle = INK;
  g.lineWidth = 11;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(-46, -62);
  g.lineTo(46, -62);
  g.lineTo(40, -6);
  g.quadraticCurveTo(34, 30, 0, 36);
  g.quadraticCurveTo(-34, 30, -40, -6);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(-46, -50);
  g.quadraticCurveTo(-82, -52, -72, -18);
  g.quadraticCurveTo(-66, 0, -42, 6);
  g.stroke();
  g.beginPath();
  g.moveTo(46, -50);
  g.quadraticCurveTo(82, -52, 72, -18);
  g.quadraticCurveTo(66, 0, 42, 6);
  g.stroke();
  g.fillRect(-9, 34, 18, 26);
  g.beginPath();
  g.moveTo(-38, 64);
  g.lineTo(38, 64);
  g.lineTo(30, 48);
  g.lineTo(-30, 48);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath();
  g.moveTo(0, -46);
  g.lineTo(9, -26);
  g.lineTo(31, -24);
  g.lineTo(14, -10);
  g.lineTo(19, 11);
  g.lineTo(0, 0);
  g.lineTo(-19, 11);
  g.lineTo(-14, -10);
  g.lineTo(-31, -24);
  g.lineTo(-9, -26);
  g.closePath();
  g.fill();
}

function crosshair(g) {
  g.strokeStyle = INK;
  g.lineWidth = 13;
  g.lineCap = 'butt';
  g.beginPath();
  g.arc(0, 0, 54, 0, Math.PI * 2);
  g.stroke();
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    g.beginPath();
    g.moveTo(Math.cos(a) * 30, Math.sin(a) * 30);
    g.lineTo(Math.cos(a) * 84, Math.sin(a) * 84);
    g.stroke();
  }
  g.fillStyle = INK;
  g.beginPath();
  g.arc(0, 0, 13, 0, Math.PI * 2);
  g.fill();
}

function blades(g) {
  const blade = (angle) => {
    g.save();
    g.rotate(angle);
    g.fillStyle = INK;
    g.beginPath();
    g.moveTo(-9, 62);
    g.lineTo(-9, -52);
    g.lineTo(0, -88);
    g.lineTo(9, -52);
    g.lineTo(9, 62);
    g.closePath();
    g.fill();
    g.fillRect(-30, 44, 60, 12);
    g.fillRect(-7, 56, 14, 30);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(-2.5, -60, 5, 98);
    g.restore();
  };
  blade(Math.PI / 4);
  blade(-Math.PI / 4);
}

function lightningBall(g) {
  const grad = g.createRadialGradient(-12, -14, 4, 0, 0, 60);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.5, '#fff2c8');
  grad.addColorStop(1, '#ffd36a');
  g.fillStyle = INK;
  g.beginPath();
  g.arc(0, 0, 64, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = grad;
  g.beginPath();
  g.arc(0, 0, 54, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = INK;
  g.beginPath();
  g.moveTo(14, -66);
  g.lineTo(-30, 8);
  g.lineTo(-4, 8);
  g.lineTo(-18, 66);
  g.lineTo(34, -12);
  g.lineTo(6, -12);
  g.closePath();
  g.fill();
  g.strokeStyle = '#ffffff';
  g.lineWidth = 5;
  g.lineJoin = 'round';
  g.stroke();
}
