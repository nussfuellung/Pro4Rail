// Abbild der Anlage: Plan (Loks, Weichen, Fahrstraßen, Schaltungen) und Live-Zustand aus Rocrail-Ereignissen.

const at = (e, n, d = '') => (e.attrs[n] ?? d);
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const bool = v => v === true || v === 'true';

export class Model {
  constructor() { this.reset(); }
  reset() {
    this.plan = { title: '', version: '', lcs: [], sws: [], sts: [], cos: [] };
    this.state = { power: 'off', auto: false, lc: {}, sw: {}, st: {}, co: {} };
    this._lc = new Map(); this._sw = new Map(); this._st = new Map(); this._co = new Map();
  }
  lc(id) { return this._lc.get(id); }
  sw(id) { return this._sw.get(id); }
  st(id) { return this._st.get(id); }
  co(id) { return this._co.get(id); }
  hasPlan() { return this._lc.size + this._sw.size + this._st.size + this._co.size > 0; }

  // plan: das <plan>-Element aus Rocrail.
  applyPlan(planEl) {
    this.reset();
    const list = tag => (planEl.children.find(c => c.tag === tag + 'list')?.children || []).filter(c => c.tag === tag && c.attrs.id);
    this.plan.title = at(planEl, 'title', 'Rocrail-Anlage');
    this.plan.version = at(planEl, 'rocrailversion');
    for (const e of list('lc')) {
      const lc = { id: at(e, 'id'), desc: at(e, 'desc'), addr: num(at(e, 'addr')), vmode: /kmh/i.test(at(e, 'V_mode')) ? 'kmh' : 'percent', vmax: num(at(e, 'V_max', '100')) || 100, fncnt: num(at(e, 'fncnt', '4')), hidden: at(e, 'show') === 'false' };
      this.plan.lcs.push(lc); this._lc.set(lc.id, { ...lc, fn: {} });
      this.state.lc[lc.id] = { v: 0, fwd: at(e, 'dir', 'true') !== 'false', fn: {}, mode: 'stop' };
    }
    for (const e of list('sw')) {
      const sw = { id: at(e, 'id'), type: at(e, 'type'), state: at(e, 'state', 'straight') };
      this.plan.sws.push(sw); this._sw.set(sw.id, sw); this.state.sw[sw.id] = sw.state;
    }
    for (const e of list('st')) {
      const st = { id: at(e, 'id'), desc: at(e, 'desc'), hidden: at(e, 'show') === 'false' };
      this.plan.sts.push(st); this._st.set(st.id, st); this.state.st[st.id] = 'free';
    }
    for (const e of list('co')) {
      const co = { id: at(e, 'id'), desc: at(e, 'desc'), type: at(e, 'type') };
      this.plan.cos.push(co); this._co.set(co.id, co); this.state.co[co.id] = at(e, 'state') === 'on';
    }
  }

  // Liefert true, wenn sich etwas geändert hat.
  applyEvent(e) {
    const s = this.state; const id = e.attrs.id;
    switch (e.tag) {
      case 'plan': this.applyPlan(e); return true;
      case 'lc': {
        const lc = this._lc.get(id); if (!lc) return false;
        const t = s.lc[id];
        if ('V' in e.attrs) { const V = num(e.attrs.V); t.v = Math.min(100, Math.max(0, lc.vmode === 'kmh' ? Math.round(V / lc.vmax * 100) : Math.round(V))); }
        if ('dir' in e.attrs) t.fwd = bool(e.attrs.dir);
        if ('fn' in e.attrs) t.fn[0] = bool(e.attrs.fn);
        if ('mode' in e.attrs) t.mode = /^(auto|wait)/i.test(e.attrs.mode) ? 'auto' : (t.v > 0 ? 'run' : 'stop');
        else t.mode = t.mode === 'auto' ? 'auto' : (t.v > 0 ? 'run' : 'stop');
        return true;
      }
      case 'fn': {
        const lc = this._lc.get(id); if (!lc) return false;
        for (const [k, v] of Object.entries(e.attrs)) { const m = /^f(\d+)$/.exec(k); if (m) s.lc[id].fn[Number(m[1])] = bool(v); }
        return true;
      }
      case 'sw': { if (!this._sw.has(id) || !('state' in e.attrs)) return false; s.sw[id] = e.attrs.state; return true; }
      case 'st': {
        if (!this._st.has(id)) return false;
        const status = e.attrs.status; // 0 = frei; sonst gestellt oder gesperrt
        s.st[id] = status === undefined ? s.st[id] : (status === '0' ? 'free' : 'locked');
        return true;
      }
      case 'co': { if (!this._co.has(id) || !('state' in e.attrs)) return false; s.co[id] = e.attrs.state === 'on'; return true; }
      case 'sys': {
        const c = e.attrs.cmd;
        if (c === 'go') { s.power = 'on'; return true; }
        if (c === 'stop' || c === 'ebreak') { s.power = 'off'; return true; }
        return false;
      }
      case 'state': { if ('power' in e.attrs) { s.power = bool(e.attrs.power) ? 'on' : 'off'; return true; } return false; }
      case 'auto': { if (e.attrs.cmd === 'on') { s.auto = true; return true; } if (e.attrs.cmd === 'off') { s.auto = false; return true; } return false; }
      default: return false;
    }
  }

  // Sofort nach einem gesendeten Befehl anwendbare Vorhersage ist bewusst nicht enthalten:
  // Die App zeigt nur, was Rocrail zurückmeldet.
  snapshot() { return { plan: this.plan, state: JSON.parse(JSON.stringify(this.state)) }; }
}
