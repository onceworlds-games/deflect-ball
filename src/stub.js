// When the page is opened on its own (no platform around it) there is no SDK: this stands in for it with a solo room, so nothing
// throws and the game can still be tried. On the platform none of this runs.
export function createStub() {
  const listeners = new Map();
  const on = (event, fn) => {
    let set = listeners.get(event);
    if (!set) listeners.set(event, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  };
  const emit = (event, ...args) => {
    for (const fn of listeners.get(event) ?? []) {
      try {
        fn(...args);
      } catch (err) {
        console.error(err);
      }
    }
  };
  const me = { id: 'local', name: 'You', presence: null, team: 0 };
  const store = new Map();
  let timer = null;
  const room = {
    stub: true,
    me,
    players: new Map([[me.id, me]]),
    host: me.id,
    isHost: true,
    connected: true,
    state: {},
    kind: 'solo',
    teams: 0,
    budget: { messagesPerSecond: 60, presenceHz: 20, bytesPerSecond: 128000 },
    match: { phase: 'lobby', n: 0, min: 1 },
    settingsValues: { rounds: 5 },
    get settings() {
      return room.settingsValues;
    },
    get online() {
      return [me];
    },
    get participants() {
      return room.match.phase === 'lobby' ? [] : [me];
    },
    get spectating() {
      return false;
    },
    get running() {
      return room.match.phase === 'playing';
    },
    isParticipant: () => room.match.phase !== 'lobby',
    matchNow: () => (room.match.phase === 'playing' ? Date.now() - room.match.startedAt : 0),
    on,
    setState(key, value) {
      if (value === null || value === undefined) delete room.state[key];
      else room.state[key] = value;
    },
    setPresence(data) {
      me.presence = data;
    },
    presenceAt: (id) => (id === me.id ? me.presence : null),
    send() {},
    setReady() {},
    clearReady() {},
    hideLobby() {},
    setSetting(id, value) {
      room.settingsValues[id] = value;
      emit('settings', room.settingsValues);
    },
    startMatch() {
      if (room.match.phase !== 'lobby') return;
      const n = room.match.n + 1;
      room.match = { phase: 'starting', n, min: 1, id: `solo${n}`, seed: (Math.random() * 2 ** 32) >>> 0, participants: [me.id], startsAt: Date.now() + 3000 };
      emit('starting', room.match);
      timer = setTimeout(() => {
        const previous = room.match;
        room.match = { ...previous, phase: 'playing', startedAt: Date.now(), pausedMs: 0 };
        delete room.match.startsAt;
        emit('matchstart', room.match);
      }, 3000);
    },
    endMatch() {
      if (timer) clearTimeout(timer);
      if (room.match.phase === 'lobby') return;
      const previous = room.match;
      room.match = { phase: 'lobby', n: previous.n, min: 1 };
      emit('matchend', room.match, previous);
    },
  };
  const ow = {
    mode: 'standalone',
    ready: async () => {},
    player: { get: async () => ({ id: me.id, name: me.name, guest: true }), avatarUrl: async () => null, rename: async () => null },
    save: {
      get: async (k) => store.get(k) ?? null,
      set: async (k, v) => void store.set(k, v),
      delete: async (k) => void store.delete(k),
      list: async () => [...store.keys()],
    },
    badges: { award: async () => false, list: async () => [], has: async () => false },
    leaderboards: { submit: async () => null, top: async () => ({ entries: [], me: null }) },
    controls: { set() {}, stick: { x: 0, y: 0 }, pressed: () => false, touch: false },
    settings: {
      quality: 'high',
      choice: 'auto',
      scale: 1,
      reducedMotion: false,
      pixelRatio: (max = 2) => Math.min(window.devicePixelRatio || 1, max),
      on() {},
    },
    ui: { setOrientation() {}, showInvite() {}, requestFullscreen() {} },
    now: () => Date.now(),
    on() {},
    rooms: { join: async () => room, on() {} },
  };
  return { ow, room };
}
