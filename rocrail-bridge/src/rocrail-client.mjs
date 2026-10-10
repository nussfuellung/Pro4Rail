// TCP-Verbindung zu Rocrail mit automatischem Wiederverbinden.
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { Deframer } from './protocol.mjs';

export class RocrailClient extends EventEmitter {
  constructor({ host = '127.0.0.1', port = 8051, log = () => {} } = {}) {
    super(); this.host = host; this.port = port; this.log = log;
    this.sock = null; this.connected = false; this.stopped = false; this.delay = 1000;
  }
  start() { this.stopped = false; this._connect(); }
  stop() { this.stopped = true; clearTimeout(this._t); this.sock?.destroy(); }
  _connect() {
    const s = net.createConnection({ host: this.host, port: this.port });
    const df = new Deframer();
    this.sock = s; s.setNoDelay(true);
    s.on('connect', () => { this.connected = true; this.delay = 1000; this.log(`Rocrail verbunden (${this.host}:${this.port})`); this.emit('connect'); });
    s.on('data', d => { for (const els of df.push(d)) for (const e of els) this.emit('element', e); });
    s.on('error', e => this.log(`Rocrail-Verbindung: ${e.code || e.message}`));
    s.on('close', () => {
      const was = this.connected; this.connected = false;
      if (was) { this.log('Rocrail getrennt'); this.emit('disconnect'); }
      if (!this.stopped) { this._t = setTimeout(() => this._connect(), this.delay); this.delay = Math.min(this.delay * 2, 15000); }
    });
  }
  // msg ist bereits gerahmt (siehe protocol.frame). Gibt false zurück, wenn gerade keine Verbindung besteht.
  send(msg) {
    if (!this.connected) return false;
    this.log(`> ${msg.replace(/^<xmlh>.*?<\/xmlh>/, '')}`);
    return this.sock.write(msg, 'utf8') || true;
  }
}
