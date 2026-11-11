// Edge "Read Aloud" TTS client — dependency-free (Node 24 native TLS + crypto).
// Usage: node tts.mjs --text "<text>" --out out.mp3 [--voice fa-IR-FaridNeural] [--rate -4%]
//        node tts.mjs --text-file in.txt --out out.mp3 [--meta out.json]
// Writes MP3 audio (audio-24khz-48kbitrate-mono-mp3) and optional word-boundary metadata.

import tls from 'node:tls';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WIN_EPOCH = 11644473600;
const WSS = 'speech.platform.bing.com';
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const SEC_MS_GEC_VERSION = `2-${CHROMIUM_FULL_VERSION}`;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  `Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0`;

function arg(name, def = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

function generateSecMsGec() {
  // v1 fallback only (v2 token is passed in with --gec, produced by gec.py)
  let ticks = Math.floor(Date.now() / 1000) + WIN_EPOCH;
  ticks -= ticks % 300;
  const ticksStr = (BigInt(ticks) * 10000000n).toString();
  return crypto.createHash('sha256').update(ticksStr + TRUSTED_CLIENT_TOKEN, 'ascii').digest('hex').toUpperCase();
}

function newMuid() {
  return crypto.randomBytes(16).toString('hex').toUpperCase();
}

function uuidHex() {
  return crypto.randomUUID().replace(/-/g, '');
}

function dateStr() {
  // Edge uses RFC1123-ish: "Mon Jan 01 2024 12:00:00 GMT+0000 (Coordinated Universal Time)"
  return new Date().toUTCString().replace(/GMT/, 'GMT+0000 (Coordinated Universal Time)');
}

// ---------- minimal WebSocket client over TLS ----------
class WS {
  constructor(socket) {
    this.sock = socket;
    this.buf = Buffer.alloc(0);
    this.frag = []; // fragmented payload pieces
    this.fragOpcode = null;
    this.onmessage = null;
    this.onclose = null;
    this.closed = false;
    socket.on('data', (d) => this._onData(d));
    socket.on('close', () => this._closed());
    socket.on('error', (e) => { this.emitError(e); });
  }

  emitError(e) { this.onerror?.(e); }

  _closed() {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }

  _onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      const f = this._readFrame();
      if (!f) break;
      this._handleFrame(f);
    }
  }

  _readFrame() {
    const b = this.buf;
    if (b.length < 2) return null;
    const fin = (b[0] & 0x80) !== 0;
    const opcode = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (b.length < off + 2) return null;
      len = b.readUInt16BE(off); off += 2;
    } else if (len === 127) {
      if (b.length < off + 8) return null;
      const big = b.readBigUInt64BE(off); off += 8;
      len = Number(big);
    }
    let mask = null;
    if (masked) {
      if (b.length < off + 4) return null;
      mask = b.subarray(off, off + 4); off += 4;
    }
    if (b.length < off + len) return null;
    let payload = b.subarray(off, off + len);
    if (mask) {
      const out = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3];
      payload = out;
    } else {
      payload = Buffer.from(payload);
    }
    this.buf = b.subarray(off + len);
    return { fin, opcode, payload };
  }

  _handleFrame({ fin, opcode, payload }) {
    if (opcode === 0x8) { this.close(); return; }
    if (opcode === 0x9) { this._send(0xa, payload); return; }
    if (opcode === 0xa) return;
    if (opcode === 0x0) {
      this.frag.push(payload);
      if (fin) {
        const whole = Buffer.concat(this.frag);
        const op = this.fragOpcode;
        this.frag = []; this.fragOpcode = null;
        this._deliver(op, whole);
      }
      return;
    }
    if (!fin) { this.fragOpcode = opcode; this.frag = [payload]; return; }
    this._deliver(opcode, payload);
  }

  _deliver(opcode, payload) {
    if (opcode === 0x1) this.onmessage?.({ type: 'text', data: payload.toString('utf8') });
    else if (opcode === 0x2) this.onmessage?.({ type: 'binary', data: payload });
  }

  _send(opcode, payload) {
    if (this.sock.destroyed) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(6);
      header[1] = 0x80 | len;
    } else if (len < 65536) {
      header = Buffer.alloc(8);
      header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(14);
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode;
    const mask = crypto.randomBytes(4);
    mask.copy(header, header.length - 4);
    const body = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) body[i] = payload[i] ^ mask[i & 3];
    this.sock.write(Buffer.concat([header, body]));
  }

  sendText(s) { this._send(0x1, Buffer.from(s, 'utf8')); }

  close() {
    try { this._send(0x8, Buffer.alloc(0)); } catch { /* ignore */ }
    this.sock.end();
    this._closed();
  }
}

function connect() {
  return new Promise((resolve, reject) => {
    const connectionId = uuidHex();
    const gec = arg('gec', null) || generateSecMsGec();
    const muid = arg('muid', null) || newMuid();
    const url =
      `/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
      `&ConnectionId=${connectionId}` +
      `&Sec-MS-GEC=${gec}` +
      `&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;
    const key = crypto.randomBytes(16).toString('base64');
    const sock = tls.connect({ host: WSS, port: 443, servername: WSS }, () => {
      const req =
        `GET ${url} HTTP/1.1\r\n` +
        `Host: ${WSS}\r\n` +
        `Connection: Upgrade\r\n` +
        `Upgrade: websocket\r\n` +
        `Sec-WebSocket-Key: ${key}\r\n` +
        `Sec-WebSocket-Version: 13\r\n` +
        `Pragma: no-cache\r\n` +
        `Cache-Control: no-cache\r\n` +
        `Origin: chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold\r\n` +
        `Accept-Encoding: gzip, deflate, br\r\n` +
        `Accept-Language: en-US,en;q=0.9\r\n` +
        `Cookie: muid=${muid};\r\n` +
        `User-Agent: ${UA}\r\n\r\n`;
      sock.write(req);
    });
    sock.setTimeout(30000, () => { sock.destroy(new Error('socket timeout')); });

    let raw = Buffer.alloc(0);
    const onHandshake = (chunk) => {
      raw = Buffer.concat([raw, chunk]);
      const idx = raw.indexOf('\r\n\r\n');
      if (idx === -1) return;
      const head = raw.subarray(0, idx).toString('utf8');
      const rest = raw.subarray(idx + 4);
      sock.removeListener('data', onHandshake);
      if (!/^HTTP\/1\.1 101/.test(head)) {
        reject(new Error('handshake failed: ' + head.split('\r\n')[0]));
        sock.destroy();
        return;
      }
      const ws = new WS(sock);
      if (rest.length) ws._onData(rest);
      resolve(ws);
    };
    sock.once('data', onHandshake);
    sock.once('error', reject);
  });
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

async function synthesize({ text, voice, rate, pitch, volume }) {
  const ws = await connect();
  const audio = [];
  const words = [];
  const requestId = uuidHex();
  let doneTimer = null;

  const done = new Promise((resolve, reject) => {
    ws.onerror = reject;
    ws.onmessage = (m) => {
      if (m.type === 'text') {
        const sep = m.data.indexOf('\r\n\r\n');
        const headers = sep === -1 ? m.data : m.data.slice(0, sep);
        const body = sep === -1 ? '' : m.data.slice(sep + 4);
        if (headers.includes('Path:turn.end')) resolve();
        else if (headers.includes('Path:audio.metadata')) {
          try {
            const j = JSON.parse(body);
            for (const md of j.Metadata ?? []) {
              if (md.Type === 'WordBoundary') words.push(md.Data);
            }
          } catch { /* ignore */ }
        }
      } else {
        const headerLen = m.data.readUInt16BE(0);
        const header = m.data.subarray(2, 2 + headerLen).toString('utf8');
        if (header.includes('Path:audio')) audio.push(m.data.subarray(2 + headerLen));
      }
    };
    const timer = setTimeout(() => reject(new Error('tts timeout')), 60000);
    timer.unref?.();
    doneTimer = timer;
  });

  const ts = dateStr();
  const config =
    `X-Timestamp:${ts}\r\n` +
    `Content-Type:application/json; charset=utf-8\r\n` +
    `Path:speech.config\r\n\r\n` +
    JSON.stringify({
      context: {
        synthesis: {
          audio: {
            metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'true' },
            outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
          },
        },
      },
    });
  ws.sendText(config);

  const ssml =
    `X-RequestId:${requestId}\r\n` +
    `Content-Type:application/ssml+xml\r\n` +
    `X-Timestamp:${ts}Z\r\n` +
    `Path:ssml\r\n\r\n` +
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
    `<voice name='${voice}'>` +
    `<prosody pitch='${pitch}' rate='${rate}' volume='${volume}'>${escapeXml(text)}</prosody>` +
    `</voice></speak>`;
  ws.sendText(ssml);

  try {
    await done;
  } finally {
    if (doneTimer) clearTimeout(doneTimer);
  }
  ws.close();
  return { audio: Buffer.concat(audio), words };
}

const textFile = arg('text-file');
const text = textFile ? fs.readFileSync(textFile, 'utf8') : arg('text');
const out = arg('out');
if (!text || typeof text !== 'string' || !out) {
  console.error('usage: node tts.mjs (--text T | --text-file F) --out out.mp3 [--voice V] [--rate +0%] [--pitch +0Hz] [--meta m.json]');
  process.exit(2);
}
const voice = arg('voice', 'fa-IR-FaridNeural');
const rate = arg('rate', '+0%');
const pitch = arg('pitch', '+0Hz');
const volume = arg('volume', '+0%');

const { audio, words } = await synthesize({ text, voice, rate, pitch, volume });
if (!audio.length) {
  console.error('no audio received');
  process.exit(3);
}
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, audio);
const metaOut = arg('meta');
if (metaOut) fs.writeFileSync(metaOut, JSON.stringify({ text, voice, words }, null, 2));
console.log(`ok ${out} bytes=${audio.length} words=${words.length}`);
