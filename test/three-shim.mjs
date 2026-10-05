// three.js as it is, except that WebGLRenderer is a stand-in that accepts every call (so the scene can be built and "drawn" in node).
export * from '../node_modules/three/build/three.module.js';

const swallow = () =>
  new Proxy(function () {}, {
    get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : swallow()),
    set: () => true,
    apply: () => swallow(),
  });

export class WebGLRenderer {
  constructor(opts = {}) {
    this.domElement = opts.canvas;
    this.shadowMap = { enabled: false, type: 0 };
    this.capabilities = { isWebGL2: true, getMaxAnisotropy: () => 8 };
    this.extensions = { has: () => false, get: () => null };
    this.info = { render: { calls: 0 } };
    this.autoClear = true;
    this.renders = 0;
    this.pixelRatio = 1;
    this.width = 0;
    this.height = 0;
  }
  setPixelRatio(v) {
    this.pixelRatio = v;
  }
  getPixelRatio() {
    return this.pixelRatio;
  }
  setSize(w, h) {
    this.width = w;
    this.height = h;
  }
  setClearColor() {}
  render(scene, camera) {
    // a real renderer would update world matrices; do the same so bad transforms (NaN) show up
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();
    this.renders++;
  }
  dispose() {}
  getRenderTarget() {
    return null;
  }
  get toneMapping() {
    return 0;
  }
  set toneMapping(v) {}
  get outputColorSpace() {
    return 'srgb';
  }
  set outputColorSpace(v) {}
  get toneMappingExposure() {
    return 1;
  }
  set toneMappingExposure(v) {}
  get gl() {
    return swallow();
  }
}
