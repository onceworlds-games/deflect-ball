// Just enough browser for the game's own code to run in node: elements by id from index.html, a canvas whose 2D context accepts
// everything, an AudioContext that does the same, virtual time (Date.now, performance.now, timers, requestAnimationFrame) and events.
import { readFileSync } from 'node:fs';

const swallow = () =>
  new Proxy(function () {}, {
    get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'width' ? 10 : swallow()),
    set: () => true,
    apply: () => swallow(),
  });

class Emitter {
  constructor() {
    this._l = new Map();
  }
  addEventListener(type, fn) {
    if (!this._l.has(type)) this._l.set(type, new Set());
    this._l.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    this._l.get(type)?.delete(fn);
  }
  dispatch(type, event = {}) {
    const e = { type, target: this, preventDefault() {}, stopPropagation() {}, ...event };
    for (const fn of [...(this._l.get(type) ?? [])]) fn(e);
    return e;
  }
}

class Style {
  constructor() {
    this.props = new Map();
  }
  setProperty(k, v) {
    this.props.set(k, v);
  }
  removeProperty(k) {
    this.props.delete(k);
  }
}

class Element extends Emitter {
  constructor(tag = 'div', id = '') {
    super();
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.children = [];
    this.style = new Style();
    this.dataset = {};
    this._classes = new Set();
    this._text = '';
    this.width = 300;
    this.height = 150;
    this.parentNode = null;
    const self = this;
    this.classList = {
      add: (...c) => c.forEach((x) => self._classes.add(x)),
      remove: (...c) => c.forEach((x) => self._classes.delete(x)),
      toggle: (c, force) => {
        const on = force === undefined ? !self._classes.has(c) : !!force;
        if (on) self._classes.add(c);
        else self._classes.delete(c);
        return on;
      },
      contains: (c) => self._classes.has(c),
    };
  }
  get className() {
    return [...this._classes].join(' ');
  }
  set className(v) {
    this._classes = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent ?? '').join('');
  }
  set textContent(v) {
    this._text = String(v);
    this.children = [];
  }
  get offsetWidth() {
    return 100;
  }
  appendChild(c) {
    c.parentNode = this;
    this.children.push(c);
    return c;
  }
  append(...cs) {
    for (const c of cs) this.appendChild(typeof c === 'string' ? new TextNode(c) : c);
  }
  replaceChildren(...cs) {
    this.children = [];
    this._text = '';
    for (const c of cs) {
      if (c instanceof Fragment) for (const k of c.children) this.appendChild(k);
      else this.appendChild(c);
    }
  }
  querySelector() {
    return new Element('span');
  }
  setPointerCapture() {}
  releasePointerCapture() {}
  getContext() {
    return swallow();
  }
  requestPointerLock() {
    return undefined;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.width, height: this.height };
  }
}
class TextNode {
  constructor(t) {
    this.textContent = t;
  }
}
class Fragment extends Element {}

export function installDom({ width = 1280, height = 720 } = {}) {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  const byId = new Map();
  for (const id of ids) byId.set(id, new Element(id === 'c' ? 'canvas' : 'div', id));
  for (const id of ['setDown', 'setUp', 'play', 'stubStart', 'noticeBtn']) byId.get(id).tagName = 'BUTTON';
  // `hidden` is a class the game toggles: the elements marked hidden in the markup start hidden
  for (const m of html.matchAll(/<[^>]*id="([^"]+)"[^>]*class="([^"]*)"/g)) for (const c of m[2].split(/\s+/)) byId.get(m[1])?._classes.add(c);

  const g = new Proxy(globalThis, {
    set(target, key, value) {
      Object.defineProperty(target, key, { value, configurable: true, writable: true, enumerable: true });
      return true;
    },
  });
  const doc = new Emitter();
  doc.getElementById = (id) => byId.get(id) ?? null;
  doc.createElement = (tag) => new Element(tag);
  doc.createDocumentFragment = () => new Fragment('fragment');
  doc.createTextNode = (t) => new TextNode(t);
  doc.body = new Element('body');
  doc.fonts = { ready: Promise.resolve(), load: async () => [] };
  doc.hidden = false;
  doc.pointerLockElement = null;
  doc.activeElement = doc.body;
  doc.exitPointerLock = () => {};
  g.document = doc;
  g.window = globalThis;
  g.navigator = { userAgent: 'node', vibrate: undefined };
  g.location = { search: '', href: 'http://localhost/' };
  g.innerWidth = width;
  g.innerHeight = height;
  g.devicePixelRatio = 1;
  g.matchMedia = () => ({ matches: false, addEventListener() {} });
  g.Image = class extends Emitter {
    set src(v) {
      this._src = v;
    }
  };
  g.KeyboardEvent = class {
    constructor(type, init) {
      Object.assign(this, { type }, init);
    }
  };
  // window-level events go to the same emitter as the global object's
  const win = new Emitter();
  g.addEventListener = (...a) => win.addEventListener(...a);
  g.removeEventListener = (...a) => win.removeEventListener(...a);
  g.dispatchWindowEvent = (t, e) => win.dispatch(t, e);
  g.AudioContext = class {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 44100;
      this.state = 'running';
      this.destination = swallow();
    }
    resume() {}
    createBuffer(c, n) {
      return { getChannelData: () => new Float32Array(n) };
    }
    createGain() {
      return swallow();
    }
    createOscillator() {
      return swallow();
    }
    createBiquadFilter() {
      return swallow();
    }
    createBufferSource() {
      return swallow();
    }
    createDynamicsCompressor() {
      return swallow();
    }
  };
  return { byId, doc, dispatchWindow: (t, e) => win.dispatch(t, e) };
}

/** Virtual time: nothing in the game waits for real seconds. */
export function installClock(start = 1_000_000) {
  const g = new Proxy(globalThis, {
    set(target, key, value) {
      Object.defineProperty(target, key, { value, configurable: true, writable: true, enumerable: true });
      return true;
    },
  });
  let now = start;
  let nextId = 1;
  const timers = new Map();
  const raf = [];
  Date.now = () => now;
  g.performance = { now: () => now - start };
  g.setTimeout = (fn, ms = 0) => {
    const id = nextId++;
    timers.set(id, { at: now + ms, fn, every: 0 });
    return id;
  };
  g.setInterval = (fn, ms = 0) => {
    const id = nextId++;
    timers.set(id, { at: now + ms, fn, every: Math.max(1, ms) });
    return id;
  };
  g.clearTimeout = g.clearInterval = (id) => timers.delete(id);
  g.requestAnimationFrame = (fn) => {
    raf.push(fn);
    return raf.length;
  };
  return {
    get now() {
      return now;
    },
    /** One frame of `ms`: timers that are due, then the animation frames asked for. */
    frame(ms = 1000 / 60) {
      now += ms;
      for (let guard = 0; guard < 1000; guard++) {
        let due = null;
        for (const [id, t] of timers) if (t.at <= now && (!due || t.at < due[1].at)) due = [id, t];
        if (!due) break;
        const [id, t] = due;
        if (t.every) t.at += t.every;
        else timers.delete(id);
        t.fn();
      }
      const run = raf.splice(0);
      for (const fn of run) fn(now - start);
    },
    timers,
  };
}
