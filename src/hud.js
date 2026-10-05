// The 2D layer: everything is a short label or a number. Written with textContent only (names come from other people's browsers).
import { getAvatar } from './avatars.js';
import { ordinal } from './match.js';

const $ = (id) => document.getElementById(id);

export function createHud() {
  const el = {
    edge: $('edge'), flash: $('flash'), top: $('top'), roundNo: $('roundNo'), aliveNo: $('aliveNo'), speedNo: $('speedNo'),
    me: $('me'), ptsNo: $('ptsNo'), status: $('status'), esc: $('esc'), reticle: $('reticle'), arrow: $('arrow'), callout: $('callout'), clash: $('clash'),
    banner: $('banner'), bannerBig: $('bannerBig'), bannerSmall: $('bannerSmall'), count: $('count'), watch: $('watch'), aimhint: $('aimhint'),
    lobby: $('lobby'), settings: $('settings'), setDown: $('setDown'), setUp: $('setUp'), setVal: $('setVal'), hint: $('hint'), hintText: $('hintText'), hintKey: $('hintKey'),
    stubStart: $('stubStart'), board: $('board'), boardTitle: $('boardTitle'), boardRows: $('boardRows'), results: $('results'), resTitle: $('resTitle'), podium: $('podium'),
    you: $('you'), awards: $('awards'), title: $('title'), play: $('play'), notice: $('notice'), noticeText: $('noticeText'), noticeBtn: $('noticeBtn'),
  };
  const fg = el.reticle.querySelector('.fg');
  const last = new Map();
  /** Set a thing only if it changed (the DOM is slow to touch every frame). */
  const set = (key, value, apply) => {
    if (last.get(key) === value) return;
    last.set(key, value);
    apply(value);
  };
  const show = (node, on) => set(node.id, !!on, (v) => node.classList.toggle('hidden', !v));
  const text = (node, value) => set(`${node.id}.t`, value, (v) => (node.textContent = v));
  const restart = (node, cls) => {
    node.classList.remove('show');
    void node.offsetWidth;
    node.classList.add('show');
    if (cls !== undefined) node.dataset.k = cls;
  };

  function avatarEl(id, name, color, big) {
    const a = getAvatar(id);
    if (a.loaded && a.url) {
      const img = document.createElement('img');
      img.className = 'av';
      img.crossOrigin = 'anonymous';
      img.alt = '';
      img.src = a.url;
      img.style.setProperty('--c', color);
      return img;
    }
    const s = document.createElement('span');
    s.className = 'av';
    s.style.setProperty('--c', color);
    s.textContent = (String(name || '?').trim()[0] || '?').toUpperCase();
    void big;
    return s;
  }

  const api = {
    el,
    setReduced(on) {
      document.body.classList.toggle('reduced', !!on);
    },
    // -------------------------------------------------------------- title
    title(on) {
      show(el.title, on);
    },
    playReady(on) {
      show(el.play, on);
    },
    onPlay(fn) {
      el.play.addEventListener('click', fn);
    },
    /** One message and (maybe) one button, over everything. */
    notice(message, label = '', onClick = null) {
      el.noticeText.textContent = message;
      el.noticeBtn.classList.toggle('hidden', !label);
      el.noticeBtn.textContent = label;
      el.noticeBtn.onclick = onClick;
      el.notice.classList.remove('hidden');
    },
    hideNotice() {
      el.notice.classList.add('hidden');
    },
    // -------------------------------------------------------------- the match's top bar
    top(on, round, total, alive, speed) {
      show(el.top, on);
      if (!on) return;
      text(el.roundNo, `${round}/${total}`);
      text(el.aliveNo, String(alive));
      const s = Math.round(speed);
      text(el.speedNo, String(s));
      set('speedClass', s >= 180 ? 2 : s >= 100 ? 1 : 0, (v) => {
        el.speedNo.classList.toggle('hot', v === 1);
        el.speedNo.classList.toggle('max', v === 2);
      });
    },
    me(on, pts, status, kind) {
      show(el.me, on);
      if (!on) return;
      text(el.ptsNo, String(pts));
      text(el.status, status);
      set('statusKind', kind, (v) => {
        el.status.classList.toggle('out', v === 'out');
        el.status.classList.toggle('watch', v === 'watch');
      });
    },
    esc(on) {
      show(el.esc, on);
    },
    watch(label) {
      show(el.watch, !!label);
      if (label) text(el.watch, label);
    },
    aimHint(on) {
      show(el.aimhint, on);
    },
    // -------------------------------------------------------------- the deflect button, as the reticle
    reticle(on, frac, open) {
      show(el.reticle, on);
      if (!on) return;
      set('ret', `${Math.round(frac * 40)}|${open ? 1 : 0}`, () => {
        fg.style.strokeDashoffset = String(163.4 * Math.max(0, Math.min(1, frac)));
        el.reticle.classList.toggle('open', !!open);
        el.reticle.classList.toggle('cool', !open && frac > 0.02);
      });
    },
    // -------------------------------------------------------------- the ball coming for you
    edge(alpha) {
      set('edge', Math.round(alpha * 50), () => (el.edge.style.opacity = String(Math.max(0, Math.min(1, alpha)))));
    },
    flash(alpha, color = '#fff') {
      el.flash.style.background = color;
      el.flash.style.opacity = String(Math.max(0, Math.min(1, alpha)));
    },
    arrow(on, x, y, deg, color) {
      show(el.arrow, on);
      if (!on) return;
      el.arrow.style.left = `${Math.round(x)}px`;
      el.arrow.style.top = `${Math.round(y)}px`;
      el.arrow.style.transform = `rotate(${deg.toFixed(1)}deg)`;
      el.arrow.style.setProperty('--c', color);
    },
    // -------------------------------------------------------------- callouts
    callout(main, sub = '', kind = 'good') {
      el.callout.className = kind; // 'good', 'bad', 'gold', plus 'small'
      el.callout.textContent = main;
      if (sub) {
        const s = document.createElement('small');
        s.textContent = sub;
        el.callout.appendChild(s);
      }
      restart(el.callout);
    },
    /** "CLASH x4" at a screen spot. */
    clash(textValue, x, y) {
      el.clash.textContent = textValue;
      el.clash.style.left = `${Math.round(x)}px`;
      el.clash.style.top = `${Math.round(y)}px`;
      restart(el.clash);
    },
    clearClash() {
      el.clash.classList.remove('show');
      el.clash.style.opacity = '0';
    },
    banner(big, small) {
      el.bannerBig.textContent = big;
      el.bannerSmall.textContent = small;
      restart(el.banner);
    },
    hideBanner() {
      el.banner.classList.remove('show');
      el.banner.style.opacity = '0';
    },
    count(value) {
      el.count.textContent = String(value);
      el.count.classList.toggle('go', value === 'GO');
      restart(el.count);
    },
    hideCount() {
      el.count.classList.remove('show');
      el.count.style.opacity = '0';
    },
    // -------------------------------------------------------------- the lobby
    lobby(on, { rounds, host, hintKey, hintText, hint = true, stub }) {
      show(el.lobby, on);
      if (!on) return;
      text(el.setVal, String(rounds));
      set('settingsHost', !!host, (v) => el.settings.classList.toggle('static', !v));
      show(el.hint, hint);
      text(el.hintText, hintText);
      text(el.hintKey, hintKey);
      show(el.hintKey, !!hintKey);
      show(el.stubStart, !!stub);
    },
    onSetting(fn) {
      el.setDown.addEventListener('click', () => fn(-1));
      el.setUp.addEventListener('click', () => fn(1));
    },
    onStubStart(fn) {
      el.stubStart.addEventListener('click', fn);
    },
    // -------------------------------------------------------------- the round's scores
    board(on, title, rows) {
      show(el.board, on);
      if (!on) {
        last.delete('boardKey');
        return;
      }
      const key = `${title}|${rows.map((r) => `${r.id}:${r.total}:${r.gain}`).join(',')}`;
      if (last.get('boardKey') === key) return;
      last.set('boardKey', key);
      el.boardTitle.textContent = title;
      const frag = document.createDocumentFragment();
      rows.forEach((r, i) => {
        const row = document.createElement('div');
        row.className = `row${r.me ? ' me' : ''}${r.win ? ' win' : ''}`;
        const no = document.createElement('span');
        no.className = 'no';
        no.textContent = String(i + 1);
        const nm = document.createElement('span');
        nm.className = 'nm';
        nm.textContent = r.name;
        const gain = document.createElement('span');
        gain.className = 'gain';
        gain.textContent = r.gain > 0 ? `+${r.gain}` : '';
        const tot = document.createElement('span');
        tot.className = 'tot';
        tot.textContent = String(r.total);
        row.append(no, avatarEl(r.id, r.name, r.color), nm, gain, tot);
        frag.appendChild(row);
      });
      el.boardRows.replaceChildren(frag);
    },
    // -------------------------------------------------------------- the match's results
    results(on, data) {
      show(el.results, on);
      if (!on) {
        last.delete('resKey');
        return;
      }
      const key = JSON.stringify([data.podium.map((p) => [p.id, p.total]), data.youPlace, data.awards]);
      if (last.get('resKey') === key) return;
      last.set('resKey', key);
      const frag = document.createDocumentFragment();
      // second, first, third: the winner in the middle
      const order = [1, 0, 2];
      for (const i of order) {
        const p = data.podium[i];
        if (!p) continue;
        const step = document.createElement('div');
        step.className = `step p${i + 1}`;
        const av = avatarEl(p.id, p.name, p.color, true);
        const nm = document.createElement('div');
        nm.className = 'nm';
        nm.textContent = p.name;
        const pt = document.createElement('div');
        pt.className = 'pt';
        pt.textContent = `${p.total} PTS`;
        const block = document.createElement('div');
        block.className = 'block';
        block.textContent = String(i + 1);
        step.style.setProperty('--c', p.color);
        step.append(av, nm, pt, block);
        frag.appendChild(step);
      }
      el.podium.replaceChildren(frag);
      el.resTitle.textContent = data.youPlace === 1 ? 'YOU WIN' : 'RESULTS';
      if (data.youPlace && data.youPlace > 3) {
        el.you.textContent = `YOU: ${ordinal(data.youPlace)}`;
        el.you.classList.remove('hidden');
      } else el.you.classList.add('hidden');
      const aw = document.createDocumentFragment();
      for (const a of data.awards) {
        const d = document.createElement('div');
        d.className = 'award';
        const b = document.createElement('b');
        b.textContent = a.label;
        d.append(b, document.createTextNode(a.text));
        aw.appendChild(d);
      }
      el.awards.replaceChildren(aw);
    },
  };
  return api;
}
