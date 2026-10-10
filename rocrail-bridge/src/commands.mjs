// Übersetzt Befehle aus der App in Rocrail-XML. Alles, was nicht eindeutig gültig ist, wird abgelehnt.
import { frame, xmlEsc } from './protocol.mjs';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const isInt = n => Number.isInteger(n);

// Liefert { ok: true, msgs: [rahmenfertige Strings] } oder { ok: false, reason }.
// model muss lc(id), sw(id), st(id), co(id) liefern. Nur Objekte aus dem Plan sind erlaubt.
export function buildCommand(type, p, model) {
  const bad = reason => ({ ok: false, reason });
  const out = (...xml) => ({ ok: true, msgs: xml.map(([n, x]) => frame(n, x)) });
  p = p && typeof p === 'object' ? p : {};
  const id = typeof p.id === 'string' ? p.id : null;
  const q = xmlEsc;
  switch (type) {
    case 'power': return out(['sys', `<sys cmd="${p.on ? 'go' : 'stop'}"/>`]);
    // Nothalt: erst Fahrstrom aus, dann Nothalt für die Loks.
    case 'nothalt': return out(['sys', '<sys cmd="stop"/>'], ['sys', '<sys cmd="ebreak"/>']);
    // Plan neu anfordern, zum Beispiel nach neuen Loks in Rocrail.
    case 'plan_reload': return out(['model', '<model cmd="plan"/>']);
    case 'auto': return out(['auto', `<auto cmd="${p.on ? 'on' : 'off'}"/>`]);
    case 'lc_speed': {
      const lc = id && model.lc(id); if (!lc) return bad('Lok unbekannt');
      if (typeof p.v !== 'number' || !Number.isFinite(p.v)) return bad('Tempo ungültig');
      const pct = clamp(Math.round(p.v), 0, 100);
      const V = lc.vmode === 'kmh' ? Math.round(pct / 100 * lc.vmax) : pct;
      return out(['lc', `<lc id="${q(id)}" V="${V}"/>`]);
    }
    case 'lc_dir': {
      if (!(id && model.lc(id))) return bad('Lok unbekannt');
      return out(['lc', `<lc id="${q(id)}" dir="${p.forward ? 'true' : 'false'}"/>`]);
    }
    case 'lc_stop': {
      if (!(id && model.lc(id))) return bad('Lok unbekannt');
      return out(['lc', `<lc id="${q(id)}" V="0"/>`]);
    }
    case 'lc_fn': {
      const lc = id && model.lc(id); if (!lc) return bad('Lok unbekannt');
      if (!isInt(p.fn) || p.fn < 0 || p.fn > 31) return bad('Funktion ungültig');
      const fn = { ...(model.state?.lc?.[id]?.fn || {}), [p.fn]: !!p.on };
      const attrs = Array.from({ length: 32 }, (_, i) => `f${i}="${fn[i] ? 'true' : 'false'}"`).join(' ');
      return out(['fn', `<fn id="${q(id)}" fnchanged="${p.fn}" fnchangedstate="${p.on ? 'true' : 'false'}" ${attrs}/>`]);
    }
    case 'lc_auto': {
      if (!(id && model.lc(id))) return bad('Lok unbekannt');
      return out(['lc', `<lc id="${q(id)}" cmd="${p.on ? 'go' : 'stop'}"/>`]);
    }
    case 'sw_set': {
      if (!(id && model.sw(id))) return bad('Weiche unbekannt');
      const st = ['flip', 'straight', 'turnout', 'left', 'right'].includes(p.state) ? p.state : null;
      if (!st) return bad('Weichenlage ungültig');
      return out(['sw', `<sw id="${q(id)}" cmd="${st}"/>`]);
    }
    case 'st_set': {
      if (!(id && model.st(id))) return bad('Fahrstraße unbekannt');
      return out(['st', `<st id="${q(id)}" cmd="set"/>`]);
    }
    case 'co_set': {
      if (!(id && model.co(id))) return bad('Schaltung unbekannt');
      return out(['co', `<co id="${q(id)}" cmd="${p.on ? 'on' : 'off'}"/>`]);
    }
    default: return bad('Befehl unbekannt');
  }
}
// Nothalt und Fahrstrom aus dürfen auch dann noch laufen, wenn sie zu spät ankommen: sie machen die Anlage nur sicherer.
export const SAFE_WHEN_STALE = new Set(['nothalt']);
