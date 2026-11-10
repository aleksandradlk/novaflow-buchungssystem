// Minimal ZIP writer (stored, uncompressed) and CSV helper for the data export.
// Pure functions (also used by the Node tests).

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** files: [{ name, daten: Uint8Array|string }] → Uint8Array of a ZIP archive. */
export function zipErstellen(dateien) {
  const enc = new TextEncoder();
  const teile = [];
  const verzeichnis = [];
  let pos = 0;
  const jetzt = new Date();
  const zeit = ((jetzt.getHours() << 11) | (jetzt.getMinutes() << 5) | (jetzt.getSeconds() >> 1)) & 0xffff;
  const datum = (((jetzt.getFullYear() - 1980) << 9) | ((jetzt.getMonth() + 1) << 5) | jetzt.getDate()) & 0xffff;
  for (const d of dateien) {
    const name = enc.encode(d.name);
    const daten = typeof d.daten === 'string' ? enc.encode(d.daten) : d.daten;
    const crc = crc32(daten);
    const kopf = new DataView(new ArrayBuffer(30));
    kopf.setUint32(0, 0x04034b50, true);
    kopf.setUint16(4, 20, true);
    kopf.setUint16(6, 0x0800, true); // UTF-8 names
    kopf.setUint16(8, 0, true);
    kopf.setUint16(10, zeit, true);
    kopf.setUint16(12, datum, true);
    kopf.setUint32(14, crc, true);
    kopf.setUint32(18, daten.length, true);
    kopf.setUint32(22, daten.length, true);
    kopf.setUint16(26, name.length, true);
    teile.push(new Uint8Array(kopf.buffer), name, daten);
    const z = new DataView(new ArrayBuffer(46));
    z.setUint32(0, 0x02014b50, true);
    z.setUint16(4, 20, true);
    z.setUint16(6, 20, true);
    z.setUint16(8, 0x0800, true);
    z.setUint16(12, zeit, true);
    z.setUint16(14, datum, true);
    z.setUint32(16, crc, true);
    z.setUint32(20, daten.length, true);
    z.setUint32(24, daten.length, true);
    z.setUint16(28, name.length, true);
    z.setUint32(42, pos, true);
    verzeichnis.push(new Uint8Array(z.buffer), name);
    pos += 30 + name.length + daten.length;
  }
  const vGroesse = verzeichnis.reduce((s, x) => s + x.length, 0);
  const ende = new DataView(new ArrayBuffer(22));
  ende.setUint32(0, 0x06054b50, true);
  ende.setUint16(8, dateien.length, true);
  ende.setUint16(10, dateien.length, true);
  ende.setUint32(12, vGroesse, true);
  ende.setUint32(16, pos, true);
  const alle = [...teile, ...verzeichnis, new Uint8Array(ende.buffer)];
  const out = new Uint8Array(alle.reduce((s, x) => s + x.length, 0));
  let o = 0;
  for (const x of alle) {
    out.set(x, o);
    o += x.length;
  }
  return out;
}

function zelle(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const INTERN = new Set(['collectionId', 'collectionName', 'expand']);

/** Records → CSV (semicolon, UTF-8 with BOM – opens correctly in German Excel). */
export function csvErstellen(datensaetze) {
  const spalten = [];
  for (const r of datensaetze) for (const k of Object.keys(r)) if (!INTERN.has(k) && !spalten.includes(k)) spalten.push(k);
  const zeilen = [spalten.join(';'), ...datensaetze.map((r) => spalten.map((k) => zelle(r[k])).join(';'))];
  return `﻿${zeilen.join('\r\n')}\r\n`;
}
