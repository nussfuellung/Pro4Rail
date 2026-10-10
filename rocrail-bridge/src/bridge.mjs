// Pro4Rail-Rocrail-Bridge: holt Befehle aus der Cloud, gibt sie an Rocrail weiter und meldet Plan und Zustand zurück.
import { readFileSync } from 'node:fs';
import { frame } from './protocol.mjs';
import { Model } from './model.mjs';
import { buildCommand, SAFE_WHEN_STALE } from './commands.mjs';
import { RocrailClient } from './rocrail-client.mjs';

export class Bridge {
  constructor({ client, store, model = new Model(), maxAgeSec = 10, pollMs = 1500, heartbeatMs = 20000, log = console.log }) {
    Object.assign(this, { client, store, model, maxAgeSec, pollMs, heartbeatMs, log });
    this.dirty = false; this.planDirty = true; this.lastPush = 0; this.timers = [];
  }
  start() {
    this.client.on('connect', () => { this.client.send(frame('model', '<model cmd="plan"/>')); this.client.send(frame('sys', '<sys cmd="query"/>')); });
    this.client.on('element', e => { if (this.model.applyEvent(e)) { this.dirty = true; if (e.tag === 'plan') this.planDirty = true; } });
    this.client.on('disconnect', () => { this.dirty = true; });
    this.timers.push(setInterval(() => this.pollOnce().catch(e => this.log('Abfrage fehlgeschlagen: ' + e.message)), this.pollMs));
    this.timers.push(setInterval(() => this.pushOnce().catch(e => this.log('Senden fehlgeschlagen: ' + e.message)), 400));
    this.timers.push(setInterval(() => this.store.cleanup?.().catch(() => {}), 10 * 60 * 1000));
    this.client.start();
  }
  stop() { this.timers.forEach(clearInterval); this.client.stop(); }

  async pollOnce() {
    const { rows, serverNow } = await this.store.fetchCommands();
    if (!rows.length) return;
    const done = [];
    for (const r of rows) {
      done.push(r.id);
      const age = (serverNow - new Date(r.created_at).getTime()) / 1000;
      if (age > this.maxAgeSec && !SAFE_WHEN_STALE.has(r.type)) { this.log(`verworfen (zu alt, ${Math.round(age)} s): ${r.type}`); continue; }
      if (!this.client.connected) { this.log(`verworfen (Rocrail nicht verbunden): ${r.type}`); continue; }
      const res = buildCommand(r.type, r.payload, this.model);
      if (!res.ok) { this.log(`abgelehnt: ${r.type}: ${res.reason}`); continue; }
      for (const m of res.msgs) this.client.send(m);
    }
    await this.store.markDone(done);
  }

  async pushOnce(force = false) {
    const now = Date.now();
    if (!force && !this.dirty && now - this.lastPush < this.heartbeatMs) return;
    const snap = this.model.snapshot();
    const row = { state: { ...snap.state, connected: this.client.connected }, bridge_seen: new Date().toISOString() };
    if (this.planDirty) row.plan = snap.plan;
    this.dirty = false; this.lastPush = now;
    try { await this.store.pushLayout(row); if (row.plan) this.planDirty = false; }
    catch (e) { this.dirty = true; throw e; }
  }
}

// ---------- Supabase über die REST-Schnittstelle (ohne Zusatzpakete) ----------
export class SupabaseStore {
  constructor({ url, anonKey, email, password }) { Object.assign(this, { url: url.replace(/\/$/, ''), anonKey, email, password }); this.token = null; this.refresh = null; this.exp = 0; this.userId = null; }
  async _auth() {
    if (this.token && Date.now() < this.exp - 60000) return;
    const body = this.refresh ? { refresh_token: this.refresh } : { email: this.email, password: this.password };
    let r = await fetch(`${this.url}/auth/v1/token?grant_type=${this.refresh ? 'refresh_token' : 'password'}`, { method: 'POST', headers: { apikey: this.anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok && this.refresh) { this.refresh = null; return this._auth(); }
    if (!r.ok) throw new Error('Anmeldung bei Supabase fehlgeschlagen (' + r.status + ')');
    const j = await r.json();
    this.token = j.access_token; this.refresh = j.refresh_token; this.exp = Date.now() + j.expires_in * 1000; this.userId = j.user.id;
  }
  async _req(path, opt = {}) {
    await this._auth();
    const r = await fetch(this.url + path, { ...opt, headers: { apikey: this.anonKey, Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json', ...opt.headers } });
    if (!r.ok) throw new Error(`${opt.method || 'GET'} ${path.split('?')[0]}: ${r.status}`);
    return r;
  }
  async fetchCommands() {
    const r = await this._req('/rest/v1/rocrail_commands?done=eq.false&order=id.asc&limit=50&select=id,type,payload,created_at');
    const d = r.headers.get('date');
    return { rows: await r.json(), serverNow: d ? new Date(d).getTime() : Date.now() };
  }
  async markDone(ids) { if (ids.length) await this._req(`/rest/v1/rocrail_commands?id=in.(${ids.map(Number).join(',')})`, { method: 'PATCH', body: JSON.stringify({ done: true }) }); }
  async pushLayout(row) {
    await this._auth();
    await this._req('/rest/v1/rocrail_layout?on_conflict=owner', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ owner: this.userId, updated_at: new Date().toISOString(), ...row }) });
  }
  async cleanup() { await this._req(`/rest/v1/rocrail_commands?done=eq.true&created_at=lt.${encodeURIComponent(new Date(Date.now() - 3600e3).toISOString())}`, { method: 'DELETE' }); }
}

function loadConfig() {
  const path = process.argv[2] || 'config.json';
  let c; try { c = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { console.error(`Konfiguration ${path} nicht lesbar: ${e.message}\nKopiere config.example.json nach config.json und trage deine Daten ein.`); process.exit(1); }
  const s = c.supabase || {};
  for (const k of ['url', 'anonKey', 'email', 'password']) if (!s[k] || /DEIN/.test(s[k])) { console.error(`In ${path} fehlt supabase.${k}.`); process.exit(1); }
  return c;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('bridge.mjs')) {
  const c = loadConfig();
  const log = m => console.log(new Date().toLocaleTimeString('de-DE') + '  ' + m);
  const b = new Bridge({ client: new RocrailClient({ ...c.rocrail, log }), store: new SupabaseStore(c.supabase), maxAgeSec: c.commandMaxAgeSec ?? 10, pollMs: c.pollMs ?? 1500, log });
  b.start(); log('Pro4Rail-Bridge gestartet');
  process.on('SIGINT', () => { b.stop(); process.exit(0); });
}
