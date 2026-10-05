// Effects: sparks and confetti (one Points each), shockwave rings (a small pool), shattered fragments (one InstancedMesh).
// All pooled: nothing is created while the game runs.
import * as THREE from 'three';
import { radialTexture } from './scene.js';
import { COLORS } from './config.js';

const rand = (a, b) => a + Math.random() * (b - a);

export class Particles {
  constructor(scene, max, { size = 0.4, map = null, opacity = 1, additive = true } = {}) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.base = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.next = 0;
    this.alive = 0;
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -9999;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo = g;
    this.mat = new THREE.PointsMaterial({
      size, map, vertexColors: true, transparent: true, opacity, depthWrite: false, sizeAttenuation: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.limit = max;
  }

  /** How many may be live (quality). */
  setLimit(n) {
    this.limit = Math.max(1, Math.min(this.max, n));
  }

  spawn(x, y, z, vx, vy, vz, life, r, g, b, grav = 0, drag = 0) {
    const i = this.next;
    this.next = (this.next + 1) % this.limit;
    const k = i * 3;
    this.pos[k] = x;
    this.pos[k + 1] = y;
    this.pos[k + 2] = z;
    this.vel[k] = vx;
    this.vel[k + 1] = vy;
    this.vel[k + 2] = vz;
    this.base[k] = r;
    this.base[k + 1] = g;
    this.base[k + 2] = b;
    this.col[k] = r;
    this.col[k + 1] = g;
    this.col[k + 2] = b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = grav;
    this.drag[i] = drag;
  }

  update(dt) {
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      const k = i * 3;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[k + 1] = -9999;
        this.col[k] = this.col[k + 1] = this.col[k + 2] = 0;
        any = true;
        continue;
      }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[k] *= d;
      this.vel[k + 1] = this.vel[k + 1] * d - this.grav[i] * dt;
      this.vel[k + 2] *= d;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const f = this.life[i] / this.maxLife[i];
      const fade = f * f * (3 - 2 * f);
      this.col[k] = this.base[k] * fade;
      this.col[k + 1] = this.base[k + 1] * fade;
      this.col[k + 2] = this.base[k + 2] * fade;
      any = true;
    }
    if (any) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;
    }
  }

  clear() {
    this.life.fill(0);
    for (let i = 0; i < this.max; i++) {
      this.pos[i * 3 + 1] = -9999;
      this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

export class Rings {
  constructor(scene, count = 8) {
    this.items = [];
    const geo = new THREE.RingGeometry(0.86, 1, 56);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.items.push({ mesh, mat, age: 0, life: 1, r0: 1, r1: 1, cam: true, on: false, gain: 1 });
    }
    this.next = 0;
  }

  /** mode 'cam': faces the camera (a blast); 'ground': lies on the floor (a pulse). */
  spawn(x, y, z, color, { r0 = 0.6, r1 = 6, life = 0.45, mode = 'cam', gain = 1.2 } = {}) {
    const it = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    it.on = true;
    it.age = 0;
    it.life = life;
    it.r0 = r0;
    it.r1 = r1;
    it.cam = mode === 'cam';
    it.gain = gain;
    it.mat.color.set(color).multiplyScalar(gain);
    it.mesh.position.set(x, y, z);
    if (!it.cam) it.mesh.rotation.set(-Math.PI / 2, 0, 0);
    it.mesh.visible = true;
    it.mesh.scale.setScalar(r0);
  }

  update(dt, camera) {
    for (const it of this.items) {
      if (!it.on) continue;
      it.age += dt;
      const t = it.age / it.life;
      if (t >= 1) {
        it.on = false;
        it.mesh.visible = false;
        continue;
      }
      const e = 1 - (1 - t) * (1 - t) * (1 - t);
      it.mesh.scale.setScalar(it.r0 + (it.r1 - it.r0) * e);
      it.mat.opacity = (1 - t) * (1 - t);
      if (it.cam) it.mesh.quaternion.copy(camera.quaternion);
    }
  }

  clear() {
    for (const it of this.items) {
      it.on = false;
      it.mesh.visible = false;
    }
  }
}

export class Shards {
  constructor(scene, max = 140) {
    this.max = max;
    const geo = new THREE.TetrahedronGeometry(0.22, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.35, flatShading: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.r = new Float32Array(max * 3);
    this.rv = new Float32Array(max * 3);
    this.s = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.next = 0;
    this.limit = max;
    this.dummy = new THREE.Object3D();
    this.tmp = new THREE.Color();
    for (let i = 0; i < max; i++) {
      this.mesh.setColorAt(i, this.tmp.set(0x000000));
      this.dummy.scale.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceColor.needsUpdate = true;
    scene.add(this.mesh);
  }

  setLimit(n) {
    this.limit = Math.max(8, Math.min(this.max, n));
  }

  burst(x, y, z, color, count = 16, power = 1, upward = 5, size = 1) {
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.limit;
      const k = i * 3;
      this.p[k] = x + rand(-0.3, 0.3);
      this.p[k + 1] = y + rand(-0.5, 0.6);
      this.p[k + 2] = z + rand(-0.3, 0.3);
      const a = Math.random() * Math.PI * 2;
      const sp = rand(3, 11) * power;
      this.v[k] = Math.cos(a) * sp;
      this.v[k + 1] = rand(0.2, 1) * upward * power + 2;
      this.v[k + 2] = Math.sin(a) * sp;
      this.r[k] = rand(0, 6);
      this.r[k + 1] = rand(0, 6);
      this.r[k + 2] = rand(0, 6);
      this.rv[k] = rand(-9, 9);
      this.rv[k + 1] = rand(-9, 9);
      this.rv[k + 2] = rand(-9, 9);
      const s = rand(0.7, 1.7) * size;
      this.s[k] = s;
      this.s[k + 1] = s * rand(0.5, 1.2);
      this.s[k + 2] = s * rand(0.5, 1.2);
      this.life[i] = rand(2.2, 3.4);
      // mostly the suit's colour, some dark armour pieces
      this.tmp.set(Math.random() < 0.22 ? '#1a1f33' : color);
      this.mesh.setColorAt(i, this.tmp);
    }
    this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    const d = this.dummy;
    let any = false;
    for (let i = 0; i < this.max; i++) {
      const k = i * 3;
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        d.scale.set(0, 0, 0);
        d.updateMatrix();
        this.mesh.setMatrixAt(i, d.matrix);
        continue;
      }
      this.v[k + 1] -= 20 * dt;
      this.p[k] += this.v[k] * dt;
      this.p[k + 1] += this.v[k + 1] * dt;
      this.p[k + 2] += this.v[k + 2] * dt;
      const over = this.p[k] * this.p[k] + this.p[k + 2] * this.p[k + 2] < 26 * 26;
      if (over && this.p[k + 1] < 0.12 && this.v[k + 1] < 0) {
        this.p[k + 1] = 0.12;
        this.v[k + 1] = -this.v[k + 1] * 0.32;
        this.v[k] *= 0.72;
        this.v[k + 2] *= 0.72;
        this.rv[k] *= 0.6;
        this.rv[k + 1] *= 0.6;
        this.rv[k + 2] *= 0.6;
      }
      this.r[k] += this.rv[k] * dt;
      this.r[k + 1] += this.rv[k + 1] * dt;
      this.r[k + 2] += this.rv[k + 2] * dt;
      const fade = Math.min(1, this.life[i] / 0.5);
      d.position.set(this.p[k], this.p[k + 1], this.p[k + 2]);
      d.rotation.set(this.r[k], this.r[k + 1], this.r[k + 2]);
      d.scale.set(this.s[k] * fade, this.s[k + 1] * fade, this.s[k + 2] * fade);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    for (let i = 0; i < this.max; i++) {
      this.dummy.scale.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** All of the above, with the recipes the game uses. */
export class Fx {
  constructor(scene, camera) {
    this.camera = camera;
    const dot = radialTexture(64);
    this.sparks = new Particles(scene, 420, { size: 0.36, map: dot });
    this.confetti = new Particles(scene, 260, { size: 0.34, map: dot });
    this.rings = new Rings(scene, 8);
    this.shards = new Shards(scene, 140);
    this.c = new THREE.Color();
    this.reduced = false;
    this.q = 1;
  }

  /** quality 'low' | 'medium' | 'high', reduced motion on or off. */
  configure(quality, reduced) {
    this.reduced = reduced;
    this.q = quality === 'low' ? 0.4 : quality === 'medium' ? 0.7 : 1;
    this.sparks.setLimit(Math.round(420 * this.q));
    this.confetti.setLimit(Math.round(260 * this.q));
    this.shards.setLimit(Math.round(140 * this.q));
  }

  rgb(color) {
    this.c.set(color);
    return this.c;
  }

  /** A deflect: a ring blast, a ground pulse, sparks along the new direction and in a burst. */
  deflect(x, y, z, dx, dy, dz, color, power = 0.5) {
    const c = this.rgb(color);
    const r = c.r;
    const g = c.g;
    const b = c.b;
    this.rings.spawn(x, y, z, color, { r0: 0.6, r1: 1.8 + power * 2.6, life: 0.35, mode: 'cam', gain: 1.4 });
    this.rings.spawn(x, 0.06, z, color, { r0: 0.8, r1: 4 + power * 5, life: 0.5, mode: 'ground', gain: 1.1 });
    const n = Math.round((this.reduced ? 12 : 34 + power * 36) * this.q);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = (Math.random() - 0.5) * 1.8;
      const sp = rand(5, 18) * (0.6 + power);
      const along = Math.random() < 0.55;
      this.sparks.spawn(
        x, y, z,
        (along ? dx * sp * rand(0.5, 1.4) : 0) + Math.cos(a) * sp * 0.6, (along ? dy * sp * 0.5 : 0) + e * sp * 0.5 + 1, (along ? dz * sp * rand(0.5, 1.4) : 0) + Math.sin(a) * sp * 0.6,
        rand(0.3, 0.7), 0.8 + r, 0.8 + g, 0.8 + b, 6, 1.2,
      );
    }
  }

  /** A player breaking apart. */
  shatter(x, y, z, color) {
    const c = this.rgb(color);
    this.shards.burst(x, y + 1, z, color, Math.round(18 * Math.max(0.5, this.q)), 1);
    this.rings.spawn(x, y + 1, z, color, { r0: 0.6, r1: 3.6, life: 0.45, mode: 'cam', gain: 1.4 });
    this.rings.spawn(x, 0.06, z, color, { r0: 0.6, r1: 7, life: 0.6, mode: 'ground', gain: 1.1 });
    const n = Math.round((this.reduced ? 14 : 60) * this.q);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(3, 14);
      this.sparks.spawn(x, y + 1 + rand(-0.6, 0.6), z, Math.cos(a) * sp, rand(0, 9), Math.sin(a) * sp, rand(0.4, 0.9), 0.9 + c.r, 0.9 + c.g, 0.9 + c.b, 9, 1);
    }
  }

  /** The ball appearing: energy pulled in from all around, then a pulse. */
  charge(x, y, z, color) {
    const c = this.rgb(color);
    const n = Math.round((this.reduced ? 10 : 36) * this.q);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * 2 - 1;
      const d = rand(5, 9);
      const px = Math.cos(a) * Math.sqrt(1 - e * e) * d;
      const py = e * d;
      const pz = Math.sin(a) * Math.sqrt(1 - e * e) * d;
      this.sparks.spawn(x + px, y + py, z + pz, -px * 1.1, -py * 1.1, -pz * 1.1, 0.9, 0.8 + c.r, 0.8 + c.g, 0.8 + c.b, 0, 0);
    }
  }

  launch(x, y, z, color) {
    this.rings.spawn(x, y, z, color, { r0: 1, r1: 7, life: 0.55, mode: 'cam', gain: 1.3 });
    this.rings.spawn(x, 0.06, z, color, { r0: 1, r1: 14, life: 0.8, mode: 'ground', gain: 1.1 });
  }

  /** A small puff where something lands or dashes. */
  dust(x, y, z, count = 6) {
    const n = Math.round(count * this.q);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(0.6, 2.4);
      this.sparks.spawn(x, y + 0.1, z, Math.cos(a) * sp, rand(0.3, 1.6), Math.sin(a) * sp, rand(0.25, 0.5), 0.5, 0.7, 1.0, 1, 3);
    }
  }

  /** Confetti raining from above a spot. */
  celebrate(x, z, count = 160) {
    const n = Math.round((this.reduced ? 40 : count) * this.q);
    for (let i = 0; i < n; i++) {
      const c = this.rgb(COLORS[(Math.random() * COLORS.length) | 0]);
      this.confetti.spawn(
        x + rand(-9, 9), rand(10, 18), z + rand(-9, 9),
        rand(-2, 2), rand(-2, 1), rand(-2, 2),
        rand(2.4, 4.2), 0.7 + c.r, 0.7 + c.g, 0.7 + c.b, 4, 1.2,
      );
    }
  }

  update(dt) {
    this.sparks.update(dt);
    this.confetti.update(dt);
    this.rings.update(dt, this.camera);
    this.shards.update(dt);
  }

  clear() {
    this.sparks.clear();
    this.confetti.clear();
    this.rings.clear();
    this.shards.clear();
  }
}
