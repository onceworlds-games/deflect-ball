// Players' head pictures: asked for once, loaded into an Image (CORS-clean for canvases), cached. A player with no picture (a bot,
// or outside the platform) gets a coloured circle with their initial wherever this is drawn.
const cache = new Map();
const listeners = new Set();
let resolver = null;

/** `fn(id)` returns a promise of an image URL (or null). */
export function setAvatarSource(fn) {
  resolver = fn;
}
export function onAvatarLoad(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** { url, img, loaded } for a player; starts loading the first time. */
export function getAvatar(id) {
  let e = cache.get(id);
  if (e) return e;
  e = { url: null, img: null, loaded: false };
  cache.set(id, e);
  if (!resolver || typeof id !== 'string' || id.startsWith('bot')) return e;
  let p;
  try {
    p = Promise.resolve(resolver(id));
  } catch {
    return e;
  }
  p.then((url) => {
    if (typeof url !== 'string' || !url) return;
    e.url = url;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      e.loaded = true;
      for (const fn of listeners) {
        try {
          fn(id);
        } catch {
          /* a listener's problem */
        }
      }
    };
    img.onerror = () => {
      e.url = null;
      e.loaded = false;
    };
    img.src = url;
    e.img = img;
  }).catch(() => {});
  return e;
}

/** Draw a player's head (or the fallback circle) centred at x, y with a diameter. */
export function drawHead(ctx, id, name, color, x, y, d) {
  const e = getAvatar(id);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, d / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (e.loaded && e.img) {
    try {
      ctx.fillStyle = '#10142a';
      ctx.fillRect(x - d / 2, y - d / 2, d, d);
      ctx.drawImage(e.img, x - d / 2, y - d / 2, d, d);
      ctx.restore();
      return;
    } catch {
      /* fall through to the circle */
    }
  }
  ctx.fillStyle = color;
  ctx.fillRect(x - d / 2, y - d / 2, d, d);
  ctx.fillStyle = 'rgba(8,10,22,0.85)';
  ctx.font = `700 ${Math.round(d * 0.58)}px "Chakra Petch", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText((String(name || '?').trim()[0] || '?').toUpperCase(), x, y + d * 0.04);
  ctx.restore();
}
