// The camera: over the shoulder behind your runner (distance 7, height 3), a slow orbit for watchers and the title, and a close
// orbit around a winner. Shake is trauma squared, smooth sines, never random jitter; it moves the camera, never the player.
import * as THREE from 'three';
import { clamp } from './config.js';

const DIST = 7;
const LIFT = 1.3;
const SHOULDER = 0.9;
const PIVOT_Y = 1.7;

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;
    this.pitch = 0.1;
    this.trauma = 0;
    this.fovKick = 0;
    this.time = 0;
    this.baseFov = camera.fov;
    this.reduced = false;
    this.pos = new THREE.Vector3(0, 6, 24);
    this.look = new THREE.Vector3(0, 1, 0);
    this.wantPos = new THREE.Vector3();
    this.wantLook = new THREE.Vector3();
    this.orbitAngle = 0.6;
    this.orbitUser = 0;
    this.snap = true;
    this.glide = 1;
  }

  setBaseFov(fov) {
    this.baseFov = fov;
  }
  addTrauma(a) {
    if (this.reduced) return;
    this.trauma = Math.min(1, this.trauma + a);
  }
  kick(deg) {
    if (!this.reduced) this.fovKick = Math.min(14, this.fovKick + deg);
  }
  /** Turn by the amounts the player's hand asked for. */
  turn(dyaw, dpitch) {
    this.yaw += dyaw;
    this.pitch = clamp(this.pitch + dpitch, -0.38, 0.95);
    this.orbitUser += dyaw;
  }
  setYaw(y) {
    this.yaw = y;
  }
  /** Next frame, jump to where the camera wants to be instead of gliding. */
  cut() {
    this.snap = true;
  }

  /** Behind the runner at (x, y, z), looking where yaw and pitch point. */
  follow(x, y, z) {
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    // dir: where the camera looks (pitch is the camera's height above the line: positive looks down)
    const dx = fx * cp;
    const dy = -sp;
    const dz = fz * cp;
    const rx = -Math.cos(this.yaw);
    const rz = Math.sin(this.yaw);
    const px = x + rx * SHOULDER;
    const py = y + PIVOT_Y;
    const pz = z + rz * SHOULDER;
    this.wantPos.set(px - dx * DIST, Math.max(0.5, py - dy * DIST + LIFT), pz - dz * DIST);
    this.wantLook.set(this.wantPos.x + dx * 30, this.wantPos.y + dy * 30, this.wantPos.z + dz * 30);
    this.glide = 1;
  }

  /** Round and round a point, high up and far: for watching. */
  orbit(dt, cx, cy, cz, radius, height, speed = 0.12) {
    this.orbitAngle += dt * speed;
    const a = this.orbitAngle + this.orbitUser;
    this.wantPos.set(cx + Math.sin(a) * radius, cy + height, cz + Math.cos(a) * radius);
    this.wantLook.set(cx, cy + 1.2, cz);
    this.glide = 0;
    // keep the follow yaw in step so going back to your runner doesn't swing wildly
    this.yaw = a + Math.PI;
  }

  /** Apply shake and the glide to the camera. */
  apply(dt) {
    this.time += dt;
    const k = this.snap ? 1 : this.glide === 1 ? 1 : 1 - Math.exp(-dt * 3.2);
    this.snap = false;
    this.pos.lerp(this.wantPos, k);
    this.look.lerp(this.wantLook, k);
    const cam = this.camera;
    cam.position.copy(this.pos);
    cam.lookAt(this.look);
    const s = this.trauma * this.trauma;
    if (s > 1e-4 && !this.reduced) {
      const t = this.time;
      cam.position.x += s * 0.5 * (Math.sin(t * 33.1) + Math.sin(t * 21.7 + 1.3)) * 0.5;
      cam.position.y += s * 0.5 * (Math.sin(t * 29.3 + 2.1) + Math.sin(t * 17.9)) * 0.5;
      cam.position.z += s * 0.5 * Math.sin(t * 25.7 + 0.4);
      cam.rotation.z += s * 0.05 * Math.sin(t * 23.3 + 0.8);
    }
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    this.fovKick = Math.max(0, this.fovKick - dt * 40 * (this.fovKick / 14 + 0.2));
    const fov = this.baseFov + (this.reduced ? 0 : this.fovKick);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
