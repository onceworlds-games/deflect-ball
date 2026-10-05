// The world: a floating stone arena with glowing seams in a twilight sky. Everything here is built once; per frame only the sky
// follows the camera, the motes drift and the composer runs. Budget: about 15 draw calls for the whole set.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ARENA_R } from './config.js';
import { mulberry32 } from './rng.js';

export const CYAN = '#2de2ff';

/** A soft round dot for sprites and points. */
export function radialTexture(size = 64, stops = [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, col] of stops) grad.addColorStop(at, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const hash3 = (x, y, z) => {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s) - 0.5;
};

/** A lumpy rock: an icosahedron pushed about by a position-based noise (same position, same push, so no cracks). */
function rockGeometry(detail, amount, seed) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const n = 1 + hash3(x + seed, y, z) * amount;
    p.setXYZ(i, x * n, y * n * 0.78, z * n);
  }
  g.computeVertexNormals();
  return g;
}

/** The arena's floor: polar stone tiles with cyan seams. One canvas for the colour, one for the glow. */
function arenaTextures(size, anisotropy) {
  const rng = mulberry32(2024);
  const col = document.createElement('canvas');
  const glow = document.createElement('canvas');
  col.width = col.height = glow.width = glow.height = size;
  const c = col.getContext('2d');
  const e = glow.getContext('2d');
  const k = size / (2 * ARENA_R);
  const cx = size / 2;
  c.fillStyle = '#05060d';
  c.fillRect(0, 0, size, size);
  e.fillStyle = '#000';
  e.fillRect(0, 0, size, size);

  const radii = [0, 3.2, 7.4, 11.6, 15.8, 20, 23.4, ARENA_R - 0.6];
  const counts = [1, 8, 14, 20, 26, 32, 40];
  const gap = 0.08;
  const tile = (ctx, r0, r1, a0, a1) => {
    ctx.beginPath();
    if (r0 < 0.01) ctx.arc(cx, cx, (r1 - gap) * k, 0, Math.PI * 2);
    else {
      const da0 = gap / r0;
      const da1 = gap / r1;
      ctx.arc(cx, cx, (r1 - gap) * k, a0 + da1, a1 - da1);
      ctx.arc(cx, cx, (r0 + gap) * k, a1 - da0, a0 + da0, true);
      ctx.closePath();
    }
  };
  for (let ring = 0; ring < counts.length; ring++) {
    const r0 = radii[ring];
    const r1 = radii[ring + 1];
    const n = counts[ring];
    const off = ring * 0.41;
    for (let j = 0; j < n; j++) {
      const a0 = off + (j / n) * Math.PI * 2;
      const a1 = off + ((j + 1) / n) * Math.PI * 2;
      const l = 36 + rng() * 26;
      tile(c, r0, r1, a0, a1);
      c.fillStyle = `rgb(${(l * 0.78) | 0},${(l * 0.9) | 0},${(l * 1.2) | 0})`;
      c.fill();
      c.lineWidth = Math.max(1, 0.05 * k);
      c.strokeStyle = 'rgba(255,255,255,0.07)';
      c.stroke();
      // the seams glow
      tile(e, r0, r1, a0, a1);
      e.lineWidth = Math.max(1.5, 0.11 * k);
      e.strokeStyle = 'rgba(45,226,255,0.95)';
      e.stroke();
      if (rng() < 0.1) {
        e.fillStyle = 'rgba(45,226,255,0.1)';
        e.fill();
      }
    }
  }
  // the rim and the centre
  e.lineWidth = 0.5 * k;
  e.strokeStyle = 'rgba(45,226,255,1)';
  e.beginPath();
  e.arc(cx, cx, (ARENA_R - 0.45) * k, 0, Math.PI * 2);
  e.stroke();
  e.lineWidth = 0.22 * k;
  e.strokeStyle = 'rgba(255,255,255,0.95)';
  e.beginPath();
  e.arc(cx, cx, 1.5 * k, 0, Math.PI * 2);
  e.stroke();
  // grit
  for (let i = 0; i < size * size * 0.004; i++) {
    const x = rng() * size;
    const y = rng() * size;
    c.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.18)';
    c.fillRect(x, y, 1 + rng() * 2, 1 + rng() * 2);
  }
  const map = new THREE.CanvasTexture(col);
  const emissiveMap = new THREE.CanvasTexture(glow);
  for (const t of [map, emissiveMap]) {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = anisotropy;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
  }
  return { map, emissiveMap };
}

function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color('#04061a') },
      mid: { value: new THREE.Color('#2b1568') },
      horizon: { value: new THREE.Color('#e0507f') },
      moon: { value: new THREE.Vector3(-0.5, 0.36, -0.78).normalize() },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 moon;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 c = mix(horizon, mid, smoothstep(-0.02, 0.32, h));
        c = mix(c, top, smoothstep(0.22, 0.85, h));
        float glow = pow(max(dot(d, normalize(moon)), 0.0), 10.0);
        c += vec3(0.5, 0.35, 0.8) * glow * 0.45;
        c = mix(c, vec3(0.02, 0.015, 0.06), smoothstep(0.0, -0.25, h) * 0.92);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export function createStage(canvas, { poster = false, quality = 'high', pixelRatio = 1, width = 1280, height = 720 } = {}) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: poster || quality !== 'low',
    powerPreference: 'high-performance',
    preserveDrawingBuffer: poster,
    alpha: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoftShadowMap is gone in this three; PCF is soft with the radius below
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x05060f, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#2a1650', 70, 330);
  const camera = new THREE.PerspectiveCamera(68, width / height, 0.1, 1200);
  camera.position.set(0, 4, 24);
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy?.() ?? 1);

  // ---------------------------------------------------------------- light
  const hemi = new THREE.HemisphereLight(0x8e86ff, 0x1c1236, 2.3);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xc3d2ff, 5.2);
  sun.position.set(-24, 40, 20);
  sun.target.position.set(0, 0, 0);
  sun.shadow.camera.left = -31;
  sun.shadow.camera.right = 31;
  sun.shadow.camera.top = 31;
  sun.shadow.camera.bottom = -31;
  sun.shadow.camera.near = 8;
  sun.shadow.camera.far = 110;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  sun.shadow.radius = 3;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun, sun.target);
  const rim = new THREE.DirectionalLight(0xff5aa0, 1.7);
  rim.position.set(30, 14, -26);
  scene.add(rim);
  const ballLight = new THREE.PointLight(0x2de2ff, 0, 46, 2);
  ballLight.position.set(0, 3, 0);
  scene.add(ballLight);

  // ---------------------------------------------------------------- the arena
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const tex = arenaTextures(quality === 'low' || coarse ? 1024 : 2048, anisotropy);
  const floorMat = new THREE.MeshStandardMaterial({
    map: tex.map, emissiveMap: tex.emissiveMap, emissive: 0xffffff, emissiveIntensity: 2.1, roughness: 0.6, metalness: 0.12, color: 0xffffff,
  });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(ARENA_R, 128), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const profile = [[0, -17], [4, -14.5], [9, -10], [15, -6], [21, -3], [25, -1.1], [26.4, -0.35], [26.55, 0]].map(([r, y]) => new THREE.Vector2(r, y));
  const under = new THREE.LatheGeometry(profile, 56);
  {
    const p = under.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y > -0.4) continue;
      const x = p.getX(i);
      const z = p.getZ(i);
      const n = 1 + hash3(Math.round(x * 3), Math.round(y * 3), Math.round(z * 3)) * 0.14;
      p.setXYZ(i, x * n, y, z * n);
    }
    under.computeVertexNormals();
  }
  const underMesh = new THREE.Mesh(under, new THREE.MeshStandardMaterial({ color: 0x2a2640, roughness: 0.95, metalness: 0.05, flatShading: true, side: THREE.DoubleSide }));
  underMesh.castShadow = false;
  scene.add(underMesh);

  const rimMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.4, 1.8, 2.4), toneMapped: false });
  const rimMesh = new THREE.Mesh(new THREE.TorusGeometry(ARENA_R + 0.1, 0.2, 8, 160), rimMat);
  rimMesh.rotation.x = Math.PI / 2;
  rimMesh.position.y = 0.04;
  scene.add(rimMesh);

  // floating rocks, with a few glowing crystals among them
  const rockCount = 34;
  const rocks = new THREE.InstancedMesh(rockGeometry(1, 0.55, 3), new THREE.MeshStandardMaterial({ color: 0x3a3456, roughness: 0.92, flatShading: true }), rockCount);
  const crystals = new THREE.InstancedMesh(
    new THREE.OctahedronGeometry(0.5, 0),
    new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.5, 1.7, 2.3), toneMapped: false }),
    22,
  );
  {
    const rng = mulberry32(77);
    const m = new THREE.Object3D();
    for (let i = 0; i < rockCount; i++) {
      const a = rng() * Math.PI * 2;
      const r = 31 + rng() * 45;
      const s = 0.8 + rng() * rng() * 4.2;
      m.position.set(Math.cos(a) * r, -12 + rng() * 32, Math.sin(a) * r);
      m.rotation.set(rng() * 6, rng() * 6, rng() * 6);
      m.scale.set(s, s, s);
      m.updateMatrix();
      rocks.setMatrixAt(i, m.matrix);
    }
    for (let i = 0; i < 22; i++) {
      const a = rng() * Math.PI * 2;
      const r = 29 + rng() * 38;
      const s = 0.5 + rng() * 1.1;
      m.position.set(Math.cos(a) * r, -6 + rng() * 22, Math.sin(a) * r);
      m.rotation.set(rng() * 0.6, rng() * 6, rng() * 0.6);
      m.scale.set(s * 0.6, s * 1.8, s * 0.6);
      m.updateMatrix();
      crystals.setMatrixAt(i, m.matrix);
    }
  }
  rocks.frustumCulled = false;
  crystals.frustumCulled = false;
  scene.add(rocks, crystals);

  // distant islands
  const islandProfile = [[0, -1], [0.35, -0.8], [0.8, -0.35], [1, 0], [0.6, 0.06], [0, 0.08]].map(([r, y]) => new THREE.Vector2(r, y));
  const islandCount = 9;
  const islands = new THREE.InstancedMesh(new THREE.LatheGeometry(islandProfile, 14), new THREE.MeshStandardMaterial({ color: 0x2c2748, roughness: 1, flatShading: true, side: THREE.DoubleSide }), islandCount);
  {
    const rng = mulberry32(5150);
    const m = new THREE.Object3D();
    for (let i = 0; i < islandCount; i++) {
      const a = (i / islandCount) * Math.PI * 2 + rng() * 0.5;
      const r = 120 + rng() * 90;
      const s = 12 + rng() * 22;
      m.position.set(Math.cos(a) * r, -18 + rng() * 40, Math.sin(a) * r);
      m.rotation.set(0, rng() * 6, 0);
      m.scale.set(s, s * (0.9 + rng() * 0.8), s);
      m.updateMatrix();
      islands.setMatrixAt(i, m.matrix);
    }
  }
  islands.frustumCulled = false;
  scene.add(islands);

  // ---------------------------------------------------------------- sky
  const sky = new THREE.Mesh(new THREE.SphereGeometry(800, 40, 20), skyMaterial());
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);
  const starCount = 1400;
  const starGeo = new THREE.BufferGeometry();
  {
    const rng = mulberry32(99);
    const pos = new Float32Array(starCount * 3);
    const col = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const u = rng() * Math.PI * 2;
      const v = 0.04 + rng() * 0.96;
      const rr = Math.sqrt(1 - v * v);
      pos[i * 3] = Math.cos(u) * rr * 700;
      pos[i * 3 + 1] = v * 700;
      pos[i * 3 + 2] = Math.sin(u) * rr * 700;
      const b = 0.35 + rng() * rng() * 1.1;
      col[i * 3] = b * (0.8 + rng() * 0.2);
      col[i * 3 + 1] = b * (0.85 + rng() * 0.15);
      col[i * 3 + 2] = b;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 1.9, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, fog: false }));
  stars.frustumCulled = false;
  scene.add(stars);
  const moonDir = new THREE.Vector3(-0.5, 0.36, -0.78).normalize();
  const moon = new THREE.Mesh(new THREE.SphereGeometry(26, 32, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(1.3, 1.35, 1.7), fog: false, toneMapped: false }));
  moon.position.copy(moonDir).multiplyScalar(600);
  moon.frustumCulled = false;
  scene.add(moon);
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: radialTexture(128), color: 0x8f86ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  );
  halo.position.copy(moon.position);
  halo.scale.set(330, 330, 1);
  scene.add(halo);

  // motes drifting up through the light
  const moteCount = 130;
  const moteGeo = new THREE.BufferGeometry();
  const motePos = new Float32Array(moteCount * 3);
  const moteSpeed = new Float32Array(moteCount);
  {
    const rng = mulberry32(31);
    for (let i = 0; i < moteCount; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * 44;
      motePos[i * 3] = Math.cos(a) * r;
      motePos[i * 3 + 1] = rng() * 16;
      motePos[i * 3 + 2] = Math.sin(a) * r;
      moteSpeed[i] = 0.2 + rng() * 0.5;
    }
    moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  }
  const motes = new THREE.Points(
    moteGeo,
    new THREE.PointsMaterial({ size: 0.16, map: radialTexture(32), color: 0x6fd8ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }),
  );
  motes.frustumCulled = false;
  scene.add(motes);

  // ---------------------------------------------------------------- post
  let composer = null;
  let bloom = null;
  let current = quality;
  let W = width;
  let H = height;
  let PR = pixelRatio;

  function buildComposer() {
    composer = null;
    bloom = null;
    if (current === 'low') return;
    try {
      // half-float targets need these; without them the plain renderer does the job
      if (!renderer.capabilities.isWebGL2 || !(renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'))) return;
      const msaa = current === 'high' && !coarse;
      const rt = new THREE.WebGLRenderTarget(W * PR, H * PR, { type: THREE.HalfFloatType, samples: msaa ? 4 : 0 });
      const c = new EffectComposer(renderer, rt);
      c.setPixelRatio(PR);
      c.setSize(W, H);
      c.addPass(new RenderPass(scene, camera));
      bloom = new UnrealBloomPass(new THREE.Vector2(W, H), current === 'high' ? 0.62 : 0.5, 0.55, 0.9);
      c.addPass(bloom);
      c.addPass(new OutputPass());
      composer = c;
    } catch (err) {
      console.warn('[deflect-ball] no post effects on this device', err);
      composer = null;
      bloom = null;
    }
  }

  function fovFor(aspect) {
    return Math.min(104, Math.max(68, 68 * Math.pow(1.6 / Math.max(0.3, aspect), 0.55)));
  }

  function setQuality(q) {
    current = poster ? 'high' : q;
    const shadows = current !== 'low';
    renderer.shadowMap.enabled = shadows;
    sun.castShadow = shadows;
    const size = current === 'high' ? 2048 : 1024;
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      if (sun.shadow.map) {
        sun.shadow.map.dispose();
        sun.shadow.map = null;
      }
    }
    rocks.count = current === 'low' ? 14 : rockCount;
    crystals.count = current === 'low' ? 8 : 22;
    motes.visible = current !== 'low';
    stars.visible = true;
    scene.traverse((o) => {
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of ms) m.needsUpdate = true;
    });
    if (composer) {
      composer.dispose?.();
    }
    buildComposer();
  }

  function resize(w, h, pr) {
    W = Math.max(2, Math.floor(w));
    H = Math.max(2, Math.floor(h));
    PR = pr;
    renderer.setPixelRatio(PR);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.fov = fovFor(camera.aspect);
    camera.updateProjectionMatrix();
    if (composer) {
      composer.setPixelRatio(PR);
      composer.setSize(W, H);
    }
  }

  const tmp = new THREE.Vector3();
  function update(dt, t) {
    sky.position.copy(camera.position);
    stars.position.copy(camera.position);
    moon.position.copy(camera.position).addScaledVector(moonDir, 600);
    halo.position.copy(moon.position);
    if (motes.visible) {
      for (let i = 0; i < moteCount; i++) {
        let y = motePos[i * 3 + 1] + moteSpeed[i] * dt;
        if (y > 16) y = 0.3;
        motePos[i * 3 + 1] = y;
        motePos[i * 3] += Math.sin(t * 0.4 + i) * dt * 0.15;
      }
      moteGeo.attributes.position.needsUpdate = true;
    }
    rocks.position.y = Math.sin(t * 0.25) * 0.6;
    crystals.position.y = rocks.position.y;
    islands.rotation.y = t * 0.004;
    void tmp;
  }

  function render(dt) {
    if (composer) composer.render(dt);
    else renderer.render(scene, camera);
  }

  resize(width, height, pixelRatio);
  setQuality(quality);

  return { renderer, scene, camera, sun, hemi, ballLight, update, render, resize, setQuality, fovFor, get bloom() { return bloom; }, get composer() { return composer; } };
}

export { THREE };
