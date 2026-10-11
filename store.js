// Pro4Rail: Backend-Schicht. Demo-Modus (localStorage) oder Supabase. Die App kennt nur dieses Interface.
import { CONFIG } from './config.js';

export const DEMO = !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY;
let sb = null;

const LS = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
const objectUrls = new Map(); // Demo: MP3-Vorschau nur für die laufende Sitzung

export const defaultConfig = () => ({
  // Verbaute Funktionen. Fehlt der Eintrag (ältere Geräte), gilt die Funktion als vorhanden.
  board: 'esp32s3',
  features: { displays: true, light: true, audio: true },
  displays: [],
  light: { on: false, brightness: 100, dimmable: true },
  audio: { volume: 60, rules: [] },
});

export async function initStore() {
  if (DEMO) {
    if (!LS.get('demo_devices')) {
      LS.set('demo_devices', [{
        id: uid(), name: 'Wohnzimmer (Demo)', device_uid: 'DEMO-0001',
        last_seen: new Date().toISOString(),
        config: {
          displays: [{
            slot: 1, type: 'tft', tft: { model: 'ST7789', w: 240, h: 320 },
            seg: { kind: '7seg', driver: 'TM1637', digits: 4 },
            content: 'abfahrt', station: { id: '8000105', name: 'Frankfurt(Main)Hbf' },
            rows: 2, filter: '', imageId: null,
          }],
          light: { on: false, brightness: 100 }, audio: { volume: 60, rules: [] },
        },
      }]);
    }
    return;
  }
  const m = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  sb = m.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
}

// ---------- Auth ----------
export const Auth = {
  async user() {
    if (DEMO) return { id: 'demo', email: 'demo@lokal' };
    const { data } = await sb.auth.getSession();
    return data.session?.user ?? null;
  },
  async signIn(email, password) {
    if (DEMO) return;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
  },
  async signUp(email, password) {
    if (DEMO) return;
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) throw error;
    return data;
  },
  async signOut() { if (!DEMO) await sb.auth.signOut(); },
  onChange(cb) { if (!DEMO) sb.auth.onAuthStateChange(() => cb()); },
};

// ---------- Geräte ----------
export const Devices = {
  async list() {
    if (DEMO) return LS.get('demo_devices', []);
    const { data, error } = await sb.from('devices').select('*').order('created_at');
    if (error) throw error;
    return data;
  },
  async save(d) {
    if (DEMO) {
      const all = LS.get('demo_devices', []);
      const i = all.findIndex(x => x.id === d.id);
      if (i >= 0) all[i] = { ...all[i], name: d.name, config: d.config };
      LS.set('demo_devices', all);
      return;
    }
    const { error } = await sb.from('devices').update({ name: d.name, config: d.config }).eq('id', d.id);
    if (error) throw error;
  },
  async remove(id) {
    if (DEMO) { LS.set('demo_devices', LS.get('demo_devices', []).filter(x => x.id !== id)); return; }
    const { error } = await sb.from('devices').delete().eq('id', id);
    if (error) throw error;
  },
  // Einmaliger 6-stelliger Code, 15 Minuten gültig. Gerät löst ihn über die Edge Function "claim-device" ein.
  async createPairingCode() {
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 90000000 + 10000000); // 8 Ziffern
    const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    if (DEMO) { LS.set('demo_code', { code, expires }); return { code, expires }; }
    const { error } = await sb.from('pairing_codes').insert({ code, expires_at: expires });
    if (error) throw error;
    return { code, expires };
  },
  // Nur Demo: koppelt ein simuliertes Gerät
  async simulateClaim(name) {
    const all = LS.get('demo_devices', []);
    const d = {
      id: uid(), name, device_uid: 'DEMO-' + Math.random().toString(16).slice(2, 8).toUpperCase(),
      last_seen: new Date().toISOString(), config: defaultConfig(),
    };
    all.push(d); LS.set('demo_devices', all);
    return d;
  },
  // Ändert nur einen Teil der gespeicherten Konfiguration (Direktsteuerung), ohne offene
  // Änderungen aus anderen Reitern mitzuspeichern. `mutate` bekommt die gespeicherte config.
  async patchConfig(id, mutate) {
    if (DEMO) {
      const all = LS.get('demo_devices', []);
      const d = all.find(x => x.id === id);
      if (!d) return;
      d.config = d.config || {}; mutate(d.config);
      LS.set('demo_devices', all);
      return;
    }
    const { data, error } = await sb.from('devices').select('config').eq('id', id).single();
    if (error) throw error;
    const cfg = data.config || {}; mutate(cfg);
    const up = await sb.from('devices').update({ config: cfg }).eq('id', id);
    if (up.error) throw up.error;
  },
  async command(deviceId, type, payload = {}) {
    if (DEMO) { LS.set('demo_last_cmd', { deviceId, type, payload, at: Date.now() }); return; }
    const { error } = await sb.from('commands').insert({ device_id: deviceId, type, payload });
    if (error) throw error;
  },
};

// ---------- Medien ----------
export const Media = {
  async list() {
    if (DEMO) return LS.get('demo_media', []);
    const { data, error } = await sb.from('media').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },
  async upload(file, kind) {
    const id = uid();
    if (DEMO) {
      const all = LS.get('demo_media', []);
      const item = { id, name: file.name, kind, size: file.size, created_at: new Date().toISOString() };
      if (kind === 'image' && file.size < 400000) item.dataUrl = await blobToDataUrl(file);
      if (kind === 'audio') objectUrls.set(id, URL.createObjectURL(file));
      all.unshift(item); LS.set('demo_media', all);
      return item;
    }
    const { data: u } = await sb.auth.getUser();
    const path = `${u.user.id}/${id}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
    const up = await sb.storage.from('media').upload(path, file, { contentType: file.type });
    if (up.error) throw up.error;
    const { data, error } = await sb.from('media')
      .insert({ id, name: file.name, kind, path, size: file.size }).select().single();
    if (error) throw error;
    return data;
  },
  async url(item) {
    if (DEMO) return item.dataUrl || objectUrls.get(item.id) || null;
    const { data } = await sb.storage.from('media').createSignedUrl(item.path, 3600);
    return data?.signedUrl ?? null;
  },
  async remove(item) {
    if (DEMO) { LS.set('demo_media', LS.get('demo_media', []).filter(x => x.id !== item.id)); return; }
    await sb.storage.from('media').remove([item.path]);
    const { error } = await sb.from('media').delete().eq('id', item.id);
    if (error) throw error;
  },
};

// ---------- Rocrail ----------
// Die App spricht nie direkt mit Rocrail. Befehle landen in der Tabelle rocrail_commands, die Bridge
// (Ordner rocrail-bridge) holt sie ab und gibt sie an Rocrail weiter. Plan und Live-Zustand schreibt die
// Bridge zurück in rocrail_layout. Befehlstypen und Nutzdaten sind in rocrail-bridge/README.md beschrieben.

// Demo-Anlage, damit sich die Oberfläche ohne echte Anlage ausprobieren lässt.
export const DEMO_PLAN = {
  title: 'Demo-Anlage', version: 'Demo',
  lcs: [
    { id: 'BR 103', desc: 'Intercity-Lok', addr: 103, vmode: 'percent', vmax: 100, fncnt: 8, v: 0, fwd: true },
    { id: 'V 200', desc: 'Diesellok', addr: 2200, vmode: 'percent', vmax: 100, fncnt: 4, v: 0, fwd: true },
    { id: 'Köf', desc: 'Rangierlok', addr: 12, vmode: 'percent', vmax: 100, fncnt: 2, v: 0, fwd: true },
  ],
  sws: [
    { id: 'W1', type: 'right', state: 'straight' }, { id: 'W2', type: 'left', state: 'turnout' },
    { id: 'W3', type: 'right', state: 'straight' }, { id: 'W4', type: 'left', state: 'straight' },
  ],
  sts: [
    { id: 'Einfahrt Gleis 1', desc: '', hidden: false }, { id: 'Einfahrt Gleis 2', desc: '', hidden: false },
    { id: 'Ausfahrt Nord', desc: '', hidden: false }, { id: '[sb1-]-[cb1+]', desc: 'Generated by the analyser', hidden: true },
  ],
  cos: [{ id: 'Bahnhofslicht', desc: '', type: 'light' }, { id: 'Schranke', desc: '', type: 'default' }],
};

const rrListeners = new Set();
let rrDemo = null; // { plan, state }

function rrInitialState(plan) {
  const st = { power: 'off', auto: false, lc: {}, sw: {}, st: {}, co: {} };
  (plan.lcs || []).forEach(l => { st.lc[l.id] = { v: l.v || 0, fwd: l.fwd !== false, fn: {}, mode: 'stop' }; });
  (plan.sws || []).forEach(s => { st.sw[s.id] = s.state || 'straight'; });
  (plan.cos || []).forEach(c => { st.co[c.id] = false; });
  return st;
}
function rrDemoLoad() {
  if (!rrDemo) { const plan = LS.get('demo_rocrail_plan', DEMO_PLAN); rrDemo = { plan, state: rrInitialState(plan) }; }
  return rrDemo;
}
function rrNotify() {
  const d = rrDemoLoad();
  const row = { plan: d.plan, state: JSON.parse(JSON.stringify(d.state)), bridge_seen: new Date().toISOString() };
  rrListeners.forEach(cb => cb(row));
}
function rrDemoApply(type, p) {
  const s = rrDemoLoad().state; const lc = s.lc[p.id];
  switch (type) {
    case 'power': s.power = p.on ? 'on' : 'off'; break;
    case 'nothalt': s.power = 'off'; s.auto = false; Object.values(s.lc).forEach(l => { l.v = 0; l.mode = 'stop'; }); break;
    case 'auto': s.auto = !!p.on; break;
    case 'lc_speed': if (lc) { lc.v = p.v; lc.mode = p.v > 0 ? 'run' : 'stop'; } break;
    case 'lc_dir': if (lc) lc.fwd = !!p.forward; break;
    case 'lc_stop': if (lc) { lc.v = 0; lc.mode = 'stop'; } break;
    case 'lc_fn': if (lc) lc.fn[p.fn] = !!p.on; break;
    case 'lc_auto': if (lc) lc.mode = p.on ? 'auto' : 'stop'; break;
    case 'sw_set': if (p.id in s.sw) s.sw[p.id] = p.state === 'flip' ? (s.sw[p.id] === 'straight' ? 'turnout' : 'straight') : p.state; break;
    case 'st_set': s.st[p.id] = 'locked'; setTimeout(() => { s.st[p.id] = 'free'; rrNotify(); }, 2500); break;
    case 'co_set': s.co[p.id] = !!p.on; break;
    case 'plan_reload': break;
    default: break;
  }
}

export const Rocrail = {
  // Liefert { plan, state, bridge_seen }. Ohne Anlage sind plan und state leer.
  async get() {
    if (DEMO) { const d = rrDemoLoad(); return { plan: d.plan, state: JSON.parse(JSON.stringify(d.state)), bridge_seen: new Date().toISOString() }; }
    const { data, error } = await sb.from('rocrail_layout').select('*').maybeSingle();
    if (error) throw error;
    return data ?? { plan: {}, state: {}, bridge_seen: null };
  },
  // Plan aus einer geladenen plan.xml übernehmen (Notfallweg, falls die Bridge den Plan nicht liefert).
  async setPlan(plan) {
    if (DEMO) { LS.set('demo_rocrail_plan', plan); rrDemo = null; rrNotify(); return; }
    const { data: u } = await sb.auth.getUser();
    const { error } = await sb.from('rocrail_layout').upsert({ owner: u.user.id, plan, updated_at: new Date().toISOString() });
    if (error) throw error;
  },
  async useDemoPlan() { if (DEMO) { localStorage.removeItem('demo_rocrail_plan'); rrDemo = null; rrNotify(); } },
  async command(type, payload = {}) {
    if (DEMO) { rrDemoApply(type, payload); rrNotify(); return; }
    const { error } = await sb.from('rocrail_commands').insert({ type, payload });
    if (error) throw error;
  },
  // cb bekommt bei jeder Änderung die komplette Zeile. Gibt eine Funktion zum Abmelden zurück.
  subscribe(cb) {
    if (DEMO) { rrListeners.add(cb); return () => rrListeners.delete(cb); }
    const ch = sb.channel('rocrail-layout')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rocrail_layout' }, p => { if (p.new) cb(p.new); })
      .subscribe();
    return () => { sb.removeChannel(ch); };
  },
};

function blobToDataUrl(b) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
}
