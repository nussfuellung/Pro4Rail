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
  displays: [],
  light: { on: false, brightness: 100 },
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
    const code = String(Math.floor(Math.random() * 900000) + 100000);
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

function blobToDataUrl(b) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
}
