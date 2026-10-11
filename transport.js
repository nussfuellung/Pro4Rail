// Fahrplandaten: Haltestellensuche und Abfahrten. Die Quelle wird in config.js gewählt.
//  - 'transitous': offene Fahrplan-Schnittstelle (MOTIS), ohne Schlüssel. Bedingungen: siehe config.js.
//  - 'dbrest':     eigene Instanz von db-rest (db-vendo-client), Adresse in DBREST_API.
// Beide liefern dieselbe Form zurück: { line, dir, when, planned, delay (Minuten), platform, cancelled }.
import { CONFIG } from './config.js';

const cache = new Map();
const CACHE_MS = 30000;
export const clearDepartureCache = () => cache.clear();
export const sourceName = () => CONFIG.DATA_SOURCE === 'dbrest' ? 'db-rest' : 'Transitous';

const base = () => (CONFIG.DATA_SOURCE === 'dbrest' ? CONFIG.DBREST_API : CONFIG.TRANSITOUS_API).replace(/\/$/, '');
async function getJson(url, f) {
  const r = await f(url);
  if (!r.ok) throw new Error(`Fahrplanserver antwortet mit ${r.status}`);
  return r.json();
}

// ---------- Haltestellensuche ----------
export async function searchStations(q, f = fetch) {
  if (CONFIG.DATA_SOURCE === 'dbrest') {
    const j = await getJson(`${base()}/locations?query=${encodeURIComponent(q)}&results=6&stops=true&addresses=false&poi=false`, f);
    return j.filter(x => x.id && x.name).map(x => ({ id: String(x.id), name: x.name }));
  }
  const j = await getJson(`${base()}${CONFIG.GEOCODE_PATH}?text=${encodeURIComponent(q)}&type=STOP&language=de`, f);
  return (Array.isArray(j) ? j : []).filter(x => x.id && x.name && (!x.type || x.type === 'STOP')).slice(0, 6).map(x => ({ id: String(x.id), name: x.name }));
}

// Ältere Geräte haben noch Bahnhofsnummern (zum Beispiel 8000105) gespeichert. Sie werden über den Namen neu aufgelöst.
const resolved = new Map();
async function transitousId(station, f) {
  if (!/^\d{5,8}$/.test(station.id)) return station.id;
  if (resolved.has(station.id)) return resolved.get(station.id);
  const hit = (await searchStations(station.name, f))[0];
  if (!hit) throw new Error(`Haltestelle „${station.name}“ nicht gefunden. Bitte neu auswählen.`);
  resolved.set(station.id, hit.id);
  return hit.id;
}

const iso = s => (s ? new Date(s).getTime() : NaN);
function fromTransitous(j) {
  const out = [];
  for (const st of j.stopTimes || []) {
    const p = st.place || {};
    const planned = p.scheduledDeparture || p.departure;
    if (!planned) continue; // nur Ankunft, keine Abfahrt
    const when = p.departure || planned;
    const delay = st.realTime === false ? null : Math.round((iso(when) - iso(planned)) / 60000);
    out.push({
      line: st.displayName || st.routeShortName || st.tripShortName || '?',
      dir: st.headsign || st.tripTo?.name || '',
      when, planned, delay: Number.isFinite(delay) ? delay : null,
      platform: p.track || p.scheduledTrack || '',
      cancelled: !!(st.cancelled || st.tripCancelled),
      via: (st.nextStops || []).map(x => x.name || x.stop?.name).filter(Boolean).slice(0, 6),   // nur wenn die Schnittstelle sie liefert
    });
  }
  return out.sort((a, b) => iso(a.when) - iso(b.when));
}
function fromDbRest(j) {
  const list = Array.isArray(j) ? j : (j.departures || []);
  return list.map(d => ({
    line: d.line?.name || '?', dir: d.direction || '', when: d.when || d.plannedWhen, planned: d.plannedWhen,
    delay: d.delay == null ? null : Math.round(d.delay / 60), platform: d.platform || d.plannedPlatform || '', cancelled: !!d.cancelled,
  }));
}
export const normalize = { transitous: fromTransitous, dbrest: fromDbRest };

// station: { id, name }
// n: wie viele Abfahrten gelesen werden. Wer nach Gleis filtert (Zugzielanzeiger), braucht viele, weil an großen Bahnhöfen
// die nächsten 15 Abfahrten oft nur wenige Minuten abdecken und ein bestimmtes Gleis darin leer sein kann.
export async function getDepartures(station, f = fetch, n = 15) {
  const key = CONFIG.DATA_SOURCE + ':' + station.id + ':' + n;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_MS) return hit.data;
  let data;
  if (CONFIG.DATA_SOURCE === 'dbrest') {
    data = fromDbRest(await getJson(`${base()}/stops/${encodeURIComponent(station.id)}/departures?duration=${n > 15 ? 240 : 120}&results=${n > 15 ? 80 : 12}`, f));
  } else {
    const id = await transitousId(station, f);
    data = fromTransitous(await getJson(`${base()}${CONFIG.STOPTIMES_PATH}?stopId=${encodeURIComponent(id)}&n=${n}&fetchStops=true`, f));
  }
  cache.set(key, { t: Date.now(), data });
  return data;
}
