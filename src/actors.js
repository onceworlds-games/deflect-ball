// The people and the ball: sleek low-poly runners (a capsule body, a visored helmet, a glowing blade), name tags, the target marker,
// and the ball with its core, shell, halo and long trail.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { radialTexture } from './scene.js';
import { drawHead, onAvatarLoad } from './avatars.js';
import { clamp, lerp } from './config.js';
import { lerpAngle } from './sim.js';

const TARGET_RED = '#ff2b3f';

// ---------------------------------------------------------------- the runner's geometry (built once, shared by everyone)
let GEO = null;

function part(geo, [r, g, b], pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale));
  const g2 = geo.clone().applyMatrix4(m);
  const n = g2.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  g2.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g2;
}

function buildGeometry() {
  const SUIT = [1, 1, 1];
  const TRIM = [0.05, 0.055, 0.09];
  const body = mergeGeometries([
    part(new THREE.CapsuleGeometry(0.33, 0.42, 6, 14), SUIT, [0, 1.06, 0], [0, 0, 0], [1, 1, 0.78]),
    part(new THREE.SphereGeometry(0.2, 10, 8), SUIT, [0.43, 1.46, 0], [0, 0, 0], [1, 0.8, 1.1]),
    part(new THREE.SphereGeometry(0.2, 10, 8), SUIT, [-0.43, 1.46, 0], [0, 0, 0], [1, 0.8, 1.1]),
    part(new THREE.BoxGeometry(0.46, 0.32, 0.06), TRIM, [0, 1.22, 0.265]),
    part(new THREE.CylinderGeometry(0.345, 0.345, 0.1, 14), TRIM, [0, 0.78, 0], [0, 0, 0], [1, 1, 0.8]),
    part(new THREE.SphereGeometry(0.28, 18, 14), TRIM, [0, 1.8, 0]),
    part(new THREE.BoxGeometry(0.34, 0.46, 0.16), TRIM, [0, 1.2, -0.3]),
    part(new THREE.CylinderGeometry(0.2, 0.28, 0.16, 12), TRIM, [0, 1.62, 0]),
  ]);
  const leg = mergeGeometries([
    part(new THREE.CylinderGeometry(0.13, 0.105, 0.52, 8), SUIT, [0, -0.26, 0]),
    part(new THREE.BoxGeometry(0.2, 0.14, 0.32), TRIM, [0, -0.58, 0.05]),
  ]);
  const arm = mergeGeometries([
    part(new THREE.CylinderGeometry(0.09, 0.075, 0.52, 8), SUIT, [0, -0.26, 0]),
    part(new THREE.SphereGeometry(0.095, 8, 6), TRIM, [0, -0.54, 0]),
  ]);
  // the blade runs along the arm's down axis, from the hand
  const blade = mergeGeometries([
    part(new THREE.BoxGeometry(0.055, 1.15, 0.055), [1, 1, 1], [0, -1.14, 0]),
    part(new THREE.BoxGeometry(0.3, 0.05, 0.09), [1, 1, 1], [0, -0.58, 0]),
  ]);
  // the visor: a band across the front of the helmet
  const visor = new THREE.SphereGeometry(0.292, 16, 6, Math.PI / 2 - 0.85, 1.7, Math.PI * 0.38, Math.PI * 0.17);
  visor.translate(0, 1.8, 0);
  // a crescent slash lying flat in front of the runner
  const arc = new THREE.RingGeometry(1.15, 2.05, 36, 1, Math.PI * 1.5 - 1.15, 2.3);
  arc.rotateX(-Math.PI / 2);
  return { body, leg, arm, blade, visor, arc };
}

const easeOut = (t) => 1 - (1 - t) * (1 - t) * (1 - t);

export class Actors {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.map = new Map();
    if (!GEO) GEO = buildGeometry();
    this.time = 0;
    this.reduced = false;
    this.shadows = true;
    this.targetMark = this.makeTargetMark();
    this.unsub = onAvatarLoad((id) => {
      const r = this.map.get(id);
      if (r) r.tag.key = '';
    });
    if (typeof document !== 'undefined' && document.fonts?.ready) document.fonts.ready.then(() => this.refreshTags()).catch(() => {});
  }

  refreshTags() {
    for (const r of this.map.values()) r.tag.key = '';
  }

  makeTargetMark() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 256, 256);
    g.strokeStyle = TARGET_RED;
    g.lineWidth = 15;
    g.beginPath();
    g.arc(128, 112, 84, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 10;
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      g.beginPath();
      g.moveTo(128 + Math.cos(a) * 62, 112 + Math.sin(a) * 62);
      g.lineTo(128 + Math.cos(a) * 112, 112 + Math.sin(a) * 112);
      g.stroke();
    }
    g.font = '700 46px "Chakra Petch", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 8;
    g.strokeStyle = 'rgba(40,0,8,0.9)';
    g.strokeText('TARGET', 128, 232);
    g.fillStyle = '#ffffff';
    g.fillText('TARGET', 128, 232);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    sprite.renderOrder = 30;
    sprite.visible = false;
    this.scene.add(sprite);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.15, 1.45, 48),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(TARGET_RED).multiplyScalar(2.2), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    this.scene.add(ring);
    // who the ball would go to if you deflected it now: a white ring under their feet
    const aim = new THREE.Mesh(
      new THREE.RingGeometry(0.95, 1.12, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 2, 2), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    );
    aim.rotation.x = -Math.PI / 2;
    aim.visible = false;
    this.scene.add(aim);
    return { sprite, ring, aim, id: null };
  }

  /** Mark the player the ball would go to if you deflected now (or clear it). */
  setAimMark(pose) {
    const a = this.targetMark.aim;
    if (!pose) {
      a.visible = false;
      return;
    }
    a.visible = true;
    a.position.set(pose.x, pose.y + 0.08, pose.z);
    a.scale.setScalar(this.reduced ? 1.2 : 1.2 + Math.sin(this.time * 7) * 0.08);
  }

  has(id) {
    return this.map.has(id);
  }
  ids() {
    return [...this.map.keys()];
  }
  get(id) {
    return this.map.get(id) ?? null;
  }

  /** Make sure a runner exists for this player. */
  ensure(id, { name = '', color = '#ffffff', bot = false } = {}) {
    let r = this.map.get(id);
    if (r) {
      if (r.hex !== color) this.recolor(r, color);
      if (r.name !== name) {
        r.name = name;
        r.tag.key = '';
      }
      return r;
    }
    const col = new THREE.Color(color);
    const suit = new THREE.MeshStandardMaterial({ color: col, vertexColors: true, roughness: 0.42, metalness: 0.22 });
    const glow = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.9), toneMapped: false, side: THREE.DoubleSide });
    const bladeMat = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.9), toneMapped: false });
    const arcMat = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(2.2), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });

    const root = new THREE.Group();
    const rig = new THREE.Group();
    root.add(rig);
    const body = new THREE.Mesh(GEO.body, suit);
    const visor = new THREE.Mesh(GEO.visor, glow);
    const legL = new THREE.Group();
    const legR = new THREE.Group();
    legL.position.set(-0.17, 0.62, 0);
    legR.position.set(0.17, 0.62, 0);
    legL.add(new THREE.Mesh(GEO.leg, suit));
    legR.add(new THREE.Mesh(GEO.leg, suit));
    const armL = new THREE.Group();
    const armR = new THREE.Group();
    // (a runner faces +z, so its right hand is on -x: that's the side the over-the-shoulder camera sees)
    armL.position.set(0.46, 1.44, 0);
    armR.position.set(-0.46, 1.44, 0);
    armL.add(new THREE.Mesh(GEO.arm, suit));
    armR.add(new THREE.Mesh(GEO.arm, suit));
    const blade = new THREE.Mesh(GEO.blade, bladeMat);
    armR.add(blade);
    const meshes = [body, ...legL.children, ...legR.children, ...armL.children, ...armR.children];
    for (const m of meshes) {
      m.castShadow = true;
      m.receiveShadow = false;
    }
    rig.add(body, visor, legL, legR, armL, armR);
    const arcPivot = new THREE.Group();
    arcPivot.position.set(0, 1.15, 0);
    const arc = new THREE.Mesh(GEO.arc, arcMat);
    arc.visible = false;
    arc.frustumCulled = false;
    arcPivot.add(arc);
    arcPivot.rotation.z = 0.12;
    root.add(arcPivot);

    // name tag
    const tc = document.createElement('canvas');
    tc.width = 320;
    tc.height = 90;
    const ttex = new THREE.CanvasTexture(tc);
    ttex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: ttex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    sprite.renderOrder = 20;
    sprite.position.set(0, 2.65, 0);
    root.add(sprite);

    // my own marker: a ring under the feet and an arrow above (only drawn for the local player)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.78, 1.0, 40),
      new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(2), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    ring.visible = false;
    root.add(ring);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.5, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 1.8, 1.8), toneMapped: false }));
    arrow.rotation.x = Math.PI;
    arrow.visible = false;
    root.add(arrow);

    root.visible = false;
    this.scene.add(root);
    r = {
      id, name, hex: color, bot, col, root, rig, body, visor, legL, legR, armL, armR, blade, arc, arcPivot, ring, arrow, suit, glow, bladeMat, arcMat,
      tag: { sprite, canvas: tc, ctx: tc.getContext('2d'), tex: ttex, key: '' },
      px: 0, py: 0, pz: 0, started: false, speed: 0, vy: 0, phase: Math.random() * 6, swingT: -1, lastSw: null, land: 0, air: 0, yaw: 0, shown: false, me: false,
    };
    this.map.set(id, r);
    return r;
  }

  recolor(r, color) {
    r.hex = color;
    r.col.set(color);
    r.suit.color.copy(r.col);
    r.glow.color.copy(r.col).multiplyScalar(1.9);
    r.bladeMat.color.copy(r.col).multiplyScalar(1.9);
    r.arcMat.color.copy(r.col).multiplyScalar(2.2);
    r.ring.material.color.copy(r.col).multiplyScalar(2);
    r.tag.key = '';
  }

  remove(id) {
    const r = this.map.get(id);
    if (!r) return;
    this.scene.remove(r.root);
    r.suit.dispose();
    r.glow.dispose();
    r.bladeMat.dispose();
    r.arcMat.dispose();
    r.ring.material.dispose();
    r.ring.geometry.dispose();
    r.arrow.material.dispose();
    r.arrow.geometry.dispose();
    r.tag.sprite.material.dispose();
    r.tag.tex.dispose();
    this.map.delete(id);
  }

  clearExcept(keep) {
    for (const id of this.ids()) if (!keep.has(id)) this.remove(id);
  }

  setShadows(on) {
    this.shadows = on;
    for (const r of this.map.values()) r.root.traverse((o) => {
      if (o.isMesh && o !== r.arc && o !== r.ring && o !== r.arrow && o !== r.visor) o.castShadow = on;
    });
  }

  drawTag(r, ready) {
    const key = `${r.name}|${ready ? 1 : 0}|${r.hex}`;
    if (r.tag.key === key) return;
    r.tag.key = key;
    const g = r.tag.ctx;
    g.clearRect(0, 0, 320, 90);
    g.fillStyle = 'rgba(8,10,22,0.84)';
    g.fillRect(0, 0, 320, 90);
    g.fillStyle = r.hex;
    g.fillRect(0, 0, 7, 90);
    g.fillRect(0, 84, 320, 6);
    drawHead(g, r.id, r.name, r.hex, 52, 42, 58);
    g.font = '700 33px "Chakra Petch", sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    let text = String(r.name || '').toUpperCase();
    if (text.length > 14) text = `${text.slice(0, 13)}…`;
    g.fillText(text, 92, ready ? 32 : 42, 218);
    if (ready) {
      g.font = '700 22px "Chakra Petch", sans-serif';
      g.fillStyle = '#8dff4d';
      g.fillText('✓ READY', 92, 64);
    }
    r.tag.tex.needsUpdate = true;
  }

  /** Put a runner where it is and animate it. `pose`: { x, y, z, r, sw } or null. opts: { show, me, ready, tag, arrow, swingNow }. */
  update(id, pose, dt, opts = {}) {
    const r = this.map.get(id);
    if (!r) return;
    const show = !!pose && opts.show !== false;
    r.me = !!opts.me;
    r.root.visible = show;
    if (!show) {
      r.started = false;
      return;
    }
    const root = r.root;
    const safeDt = Math.max(1e-4, dt);
    if (!r.started) {
      r.px = pose.x;
      r.py = pose.y;
      r.pz = pose.z;
      r.yaw = pose.r;
      r.started = true;
    }
    const jump = Math.hypot(pose.x - r.px, pose.z - r.pz);
    if (jump > 6) {
      r.px = pose.x;
      r.pz = pose.z;
      r.py = pose.y;
      r.speed = 0;
    }
    const vx = (pose.x - r.px) / safeDt;
    const vz = (pose.z - r.pz) / safeDt;
    const vy = (pose.y - r.py) / safeDt;
    const sp = Math.min(40, Math.hypot(vx, vz));
    r.speed += (sp - r.speed) * (1 - Math.exp(-dt * 14));
    r.vy += (clamp(vy, -30, 30) - r.vy) * (1 - Math.exp(-dt * 20));
    const wasAir = r.air;
    r.air = pose.y > 0.08 ? 1 : 0;
    if (wasAir && !r.air) r.land = 0.26;
    r.land = Math.max(0, r.land - dt * 1.6);
    r.px = pose.x;
    r.py = pose.y;
    r.pz = pose.z;
    root.position.set(pose.x, pose.y, pose.z);
    r.yaw = lerpAngle(r.yaw, pose.r, 1 - Math.exp(-dt * 22));
    root.rotation.y = r.yaw;

    const move = clamp(r.speed / 7, 0, 1);
    r.phase += r.speed * dt * 1.15;
    const amp = move * 0.85;
    const sw = Math.sin(r.phase);
    if (r.air) {
      r.legL.rotation.x = 0.5;
      r.legR.rotation.x = -0.25;
    } else {
      r.legL.rotation.x = sw * amp;
      r.legR.rotation.x = -sw * amp;
    }
    r.armL.rotation.x = -sw * amp * 0.7 + 0.1;
    // the squash and stretch of the whole runner
    const stretch = clamp(r.vy * 0.011, -0.1, 0.14) - r.land * 0.7;
    const sy = 1 + stretch;
    const sxz = 1 / Math.sqrt(Math.max(0.5, sy));
    r.rig.scale.set(sxz, sy, sxz);
    r.rig.rotation.x = move * 0.14;
    r.rig.position.y = r.air ? 0 : Math.abs(Math.sin(r.phase)) * 0.05 * move + Math.sin(this.time * 2 + r.id.length) * 0.012;

    // the swing
    if (typeof pose.sw === 'number' && Number.isFinite(pose.sw)) {
      const n = Math.floor(pose.sw + 1e-6);
      if (r.lastSw === null) r.lastSw = n;
      else if (n > r.lastSw) {
        r.lastSw = n;
        this.swing(id);
      } else if (n < r.lastSw) r.lastSw = n;
    }
    this.animateSwing(r, dt);

    // tag
    const showTag = opts.tag !== false && !opts.me;
    r.tag.sprite.visible = showTag;
    if (showTag) {
      this.drawTag(r, !!opts.ready);
      const dx = this.camera.position.x - pose.x;
      const dy = this.camera.position.y - (pose.y + 2.65);
      const dz = this.camera.position.z - pose.z;
      const k = clamp(Math.hypot(dx, dy, dz) * 0.05, 0.8, 2.6);
      r.tag.sprite.scale.set(3.1 * k, 0.87 * k, 1);
    }
    r.ring.visible = !!opts.me;
    r.arrow.visible = !!opts.me && !!opts.arrow;
    if (r.arrow.visible) r.arrow.position.y = 2.75 + Math.sin(this.time * 6) * 0.14;
    if (this.reduced) r.ring.material.opacity = 0.7;
    else r.ring.material.opacity = 0.65 + Math.sin(this.time * 3) * 0.2;
  }

  /** Start the blade swing on a runner. */
  swing(id) {
    const r = this.map.get(id);
    if (r) r.swingT = 0;
  }

  animateSwing(r, dt) {
    const SW = 0.3;
    if (r.swingT >= 0) {
      r.swingT += dt;
      const t = r.swingT / SW;
      if (t >= 1) {
        r.swingT = -1;
        r.arc.visible = false;
        r.arcMat.opacity = 0;
      } else {
        const e = easeOut(t);
        r.armR.rotation.x = lerp(2.3, -1.7, e);
        r.armR.rotation.z = lerp(0.2, -0.1, e);
        r.arc.visible = true;
        r.arcPivot.rotation.y = lerp(-1.15, 1.15, e);
        r.arcMat.opacity = this.reduced ? 0.55 * (1 - t) : 0.95 * (1 - t * t);
        r.bladeMat.color.copy(r.col).multiplyScalar(1.9 + (1 - t) * 3);
        return;
      }
    }
    // resting: the blade held forward and down
    r.armR.rotation.x += (-0.95 - r.armR.rotation.x) * (1 - Math.exp(-dt * 14));
    r.armR.rotation.z += (0.12 - r.armR.rotation.z) * (1 - Math.exp(-dt * 14));
    r.bladeMat.color.copy(r.col).multiplyScalar(1.9);
  }

  /** Once a frame: the clock for idle motion and the target marker. */
  tick(dt) {
    this.time += dt;
  }

  /** Show the red target marker over a player (or hide it). `pose` is where they are. */
  setTarget(id, pose, hideSprite) {
    const m = this.targetMark;
    if (!id || !pose) {
      m.sprite.visible = false;
      m.ring.visible = false;
      m.id = null;
      return;
    }
    m.id = id;
    const pulse = this.reduced ? 1 : 1 + Math.sin(this.time * 9) * 0.07;
    const dx = this.camera.position.x - pose.x;
    const dy = this.camera.position.y - (pose.y + 3.4);
    const dz = this.camera.position.z - pose.z;
    const k = clamp(Math.hypot(dx, dy, dz) * 0.07, 1, 3.2) * pulse;
    m.sprite.visible = !hideSprite;
    m.sprite.position.set(pose.x, pose.y + 3.5, pose.z);
    m.sprite.scale.set(2.5 * k, 2.5 * k, 1);
    m.ring.visible = true;
    m.ring.position.set(pose.x, pose.y + 0.06, pose.z);
    m.ring.scale.setScalar(pulse);
    m.ring.material.opacity = this.reduced ? 0.8 : 0.55 + Math.sin(this.time * 9) * 0.3;
  }

  /** The runner's head, for putting 2D things on top. */
  headOf(id, out) {
    const r = this.map.get(id);
    if (!r || !r.root.visible) return null;
    out.set(r.root.position.x, r.root.position.y + 2.3, r.root.position.z);
    return out;
  }
}

// ---------------------------------------------------------------- the ball
export class BallView {
  constructor(scene, light, camera) {
    this.scene = scene;
    this.light = light;
    this.camera = camera;
    this.group = new THREE.Group();
    this.col = new THREE.Color('#2de2ff');
    this.target = new THREE.Color('#2de2ff');
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.7, 28, 18), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 3), toneMapped: false }));
    this.shellMat = new THREE.MeshBasicMaterial({ color: this.col.clone().multiplyScalar(2), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.shell = new THREE.Mesh(new THREE.SphereGeometry(1.0, 24, 16), this.shellMat);
    this.haloMat = new THREE.SpriteMaterial({ map: radialTexture(128), color: this.col.clone().multiplyScalar(2), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.halo = new THREE.Sprite(this.haloMat);
    this.halo.scale.set(5.5, 5.5, 1);
    this.group.add(this.core, this.shell, this.halo);
    this.group.visible = false;
    scene.add(this.group);

    // the pool of light it throws on the floor
    this.poolMat = new THREE.MeshBasicMaterial({ map: radialTexture(128), color: this.col.clone().multiplyScalar(1.6), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.poolMat);
    this.pool.rotation.x = -Math.PI / 2;
    this.pool.visible = false;
    scene.add(this.pool);

    // the trail: a ribbon of N points that faces the camera
    this.N = 56;
    this.pts = new Float32Array(this.N * 3);
    this.have = 0;
    this.trailPos = new Float32Array(this.N * 2 * 3);
    this.trailCol = new Float32Array(this.N * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3));
    const idx = [];
    for (let i = 0; i < this.N - 1; i++) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
    geo.setIndex(idx);
    this.trailGeo = geo;
    this.trail = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    this.trail.frustumCulled = false;
    this.trail.visible = false;
    scene.add(this.trail);

    // a thin line to its target
    this.lineGeo = new THREE.BufferGeometry();
    this.linePos = new Float32Array(6);
    this.lineGeo.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3));
    this.lineMat = new THREE.LineBasicMaterial({ color: this.col.clone().multiplyScalar(1.4), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.line = new THREE.Line(this.lineGeo, this.lineMat);
    this.line.frustumCulled = false;
    this.line.visible = false;
    scene.add(this.line);

    this.flare = 0;
    this.time = 0;
    this.fade = 0;
    this.lastX = 0;
    this.lastY = 0;
    this.lastZ = 0;
    this.reduced = false;
    this.v1 = new THREE.Vector3();
    this.v2 = new THREE.Vector3();
    this.v3 = new THREE.Vector3();
  }

  /** The ball's trail flares bright for a moment (a deflect). */
  doFlare() {
    this.flare = 1;
  }

  clearTrail() {
    this.have = 0;
    this.trail.visible = false;
  }

  /**
   * st: { active, x, y, z, color, charge (0..1, the ball charging up at the centre, not yet live), speed, target: {x,y,z}|null }
   */
  update(dt, st) {
    this.time += dt;
    const live = !!st.active;
    const charging = !live && st.charge > 0;
    const show = live || charging;
    this.group.visible = show;
    if (!show) {
      this.pool.visible = false;
      this.line.visible = false;
      this.light.intensity = 0;
      this.fade = Math.max(0, this.fade - dt * 4);
      if (this.fade <= 0) this.trail.visible = false;
      else this.writeTrail(0, true);
      this.have = Math.min(this.have, 0);
      return;
    }
    if (st.color) this.target.set(st.color);
    this.col.lerp(this.target, 1 - Math.exp(-dt * 14));
    const c = this.col;
    this.flare = Math.max(0, this.flare - dt * 2.6);
    const pulse = this.reduced ? 1 : 1 + Math.sin(this.time * 18) * 0.05;
    const scale = charging ? 0.15 + 0.85 * st.charge * st.charge : 1;
    this.group.position.set(st.x, st.y, st.z);
    this.group.scale.setScalar(scale * pulse);
    this.shellMat.color.copy(c).multiplyScalar(2 + this.flare * 2);
    this.shell.scale.setScalar(1 + this.flare * 0.3);
    this.haloMat.color.copy(c).multiplyScalar(2 + this.flare * 2);
    const hs = 5.5 + this.flare * 3 + (charging ? (1 - st.charge) * 6 : 0);
    this.halo.scale.set(hs, hs, 1);
    this.light.color.copy(c);
    this.light.position.set(st.x, st.y + 0.3, st.z);
    this.light.intensity = (live ? 260 : 80 * st.charge) * (1 + this.flare * 0.8);

    // the pool of light on the floor
    const h = Math.max(0.2, st.y);
    this.pool.visible = true;
    this.pool.position.set(st.x, 0.05, st.z);
    const ps = 7 + h * 0.8;
    this.pool.scale.set(ps, ps, 1);
    this.poolMat.color.copy(c).multiplyScalar(1.6);
    this.poolMat.opacity = clamp(0.75 - h * 0.05, 0.25, 0.7) * scale;

    // the line to the target
    if (st.target && live) {
      this.linePos[0] = st.x;
      this.linePos[1] = st.y;
      this.linePos[2] = st.z;
      this.linePos[3] = st.target.x;
      this.linePos[4] = st.target.y;
      this.linePos[5] = st.target.z;
      this.lineGeo.attributes.position.needsUpdate = true;
      this.lineMat.color.copy(c).multiplyScalar(1.4);
      this.line.visible = true;
    } else this.line.visible = false;

    // the trail
    if (live) {
      const moved = Math.hypot(st.x - this.lastX, st.y - this.lastY, st.z - this.lastZ);
      if (this.have === 0 || moved > 7) {
        for (let i = 0; i < this.N; i++) {
          this.pts[i * 3] = st.x;
          this.pts[i * 3 + 1] = st.y;
          this.pts[i * 3 + 2] = st.z;
        }
        this.have = 1;
      } else {
        this.pts.copyWithin(3, 0, (this.N - 1) * 3);
        this.pts[0] = st.x;
        this.pts[1] = st.y;
        this.pts[2] = st.z;
      }
      this.lastX = st.x;
      this.lastY = st.y;
      this.lastZ = st.z;
      this.fade = 1;
      this.writeTrail(st.speed ?? 30, false);
    } else {
      this.trail.visible = false;
    }
  }

  writeTrail(speed, fading) {
    const cam = this.camera;
    const N = this.N;
    const { v1, v2, v3 } = this;
    const c = this.col;
    const width = (0.34 + clamp(speed / 260, 0, 0.3)) * (1 + this.flare * 1.3);
    const gain = (fading ? this.fade : 1) * (1.6 + this.flare * 1.4);
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(N - 1, i + 1);
      v1.set(this.pts[a * 3] - this.pts[b * 3], this.pts[a * 3 + 1] - this.pts[b * 3 + 1], this.pts[a * 3 + 2] - this.pts[b * 3 + 2]);
      v2.set(cam.position.x - this.pts[i * 3], cam.position.y - this.pts[i * 3 + 1], cam.position.z - this.pts[i * 3 + 2]);
      v3.crossVectors(v1, v2);
      const l = v3.length();
      if (l < 1e-6) v3.set(0, 1, 0);
      else v3.multiplyScalar(1 / l);
      const f = 1 - i / (N - 1);
      const w = width * Math.pow(f, 0.7) * (i === 0 ? 0.5 : 1);
      const k = i * 6;
      this.trailPos[k] = this.pts[i * 3] + v3.x * w;
      this.trailPos[k + 1] = this.pts[i * 3 + 1] + v3.y * w;
      this.trailPos[k + 2] = this.pts[i * 3 + 2] + v3.z * w;
      this.trailPos[k + 3] = this.pts[i * 3] - v3.x * w;
      this.trailPos[k + 4] = this.pts[i * 3 + 1] - v3.y * w;
      this.trailPos[k + 5] = this.pts[i * 3 + 2] - v3.z * w;
      const br = Math.pow(f, 1.4) * gain;
      this.trailCol[k] = this.trailCol[k + 3] = c.r * br + br * 0.25;
      this.trailCol[k + 1] = this.trailCol[k + 4] = c.g * br + br * 0.25;
      this.trailCol[k + 2] = this.trailCol[k + 5] = c.b * br + br * 0.25;
    }
    this.trailGeo.attributes.position.needsUpdate = true;
    this.trailGeo.attributes.color.needsUpdate = true;
    this.trail.visible = true;
  }
}
