// Reading customer lists in the browser: CSV and Excel (.xlsx) without external libraries.
// The file never leaves the device – only the mapped rows are sent to the instance.
// Pure functions (also used by the Node tests).

/** CSV → rows (array of arrays). Detects ; , or tab; handles quotes, BOM, CRLF. */
export function csvLesen(text) {
  const t = String(text).replace(/^﻿/, '');
  const ersteZeile = t.split(/\r?\n/)[0] || '';
  const trenner = [';', ',', '\t'].sort((a, b) => ersteZeile.split(b).length - ersteZeile.split(a).length)[0];
  const zeilen = [];
  let zeile = [];
  let feld = '';
  let inAnf = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inAnf) {
      if (c === '"' && t[i + 1] === '"') { feld += '"'; i++; } else if (c === '"') inAnf = false; else feld += c;
    } else if (c === '"') inAnf = true;
    else if (c === trenner) { zeile.push(feld); feld = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      zeile.push(feld);
      zeilen.push(zeile);
      zeile = [];
      feld = '';
    } else feld += c;
  }
  if (feld !== '' || zeile.length) {
    zeile.push(feld);
    zeilen.push(zeile);
  }
  return zeilen.filter((z) => z.some((f) => String(f).trim() !== ''));
}

// ---------------------------------------------------------------- xlsx

function u16(b, o) { return b[o] | (b[o + 1] << 8); }
function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

async function entpacken(daten, methode) {
  if (methode === 0) return daten;
  if (methode !== 8) throw new Error('Nicht unterstützte Komprimierung in der Excel-Datei.');
  const strom = new Blob([daten]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(strom).arrayBuffer());
}

/** Files of a ZIP archive: { name: Uint8Array } (reads the central directory). */
export async function zipLesen(puffer) {
  const b = new Uint8Array(puffer);
  let ende = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (u32(b, i) === 0x06054b50) { ende = i; break; }
  }
  if (ende < 0) throw new Error('Die Datei ist keine gültige Excel-Datei.');
  const anzahl = u16(b, ende + 10);
  let p = u32(b, ende + 16);
  const dateien = {};
  for (let n = 0; n < anzahl; n++) {
    const methode = u16(b, p + 10);
    const groesse = u32(b, p + 20);
    const nameLaenge = u16(b, p + 28);
    const extra = u16(b, p + 30);
    const kommentar = u16(b, p + 32);
    const lokal = u32(b, p + 42);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLaenge));
    const start = lokal + 30 + u16(b, lokal + 26) + u16(b, lokal + 28);
    dateien[name] = { methode, daten: b.subarray(start, start + groesse) };
    p += 46 + nameLaenge + extra + kommentar;
  }
  return dateien;
}

function xmlText(s) {
  return s.replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function spalteNr(ref) {
  const buchstaben = ref.replace(/\d+/g, '');
  let n = 0;
  for (const c of buchstaben) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/** Excel serial date → YYYY-MM-DD (only for plausible date values). */
function excelDatum(wert) {
  const ms = Math.round((Number(wert) - 25569) * 86400000);
  return new Date(ms).toISOString().slice(0, 10);
}

/** First worksheet of an .xlsx file → rows (array of arrays of strings). */
export async function xlsxLesen(puffer) {
  const zip = await zipLesen(puffer);
  const text = async (name) => (zip[name] ? new TextDecoder().decode(await entpacken(zip[name].daten, zip[name].methode)) : '');
  const geteilt = [...(await text('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText(m[1]));
  const blattName = Object.keys(zip).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  if (!blattName) throw new Error('In der Excel-Datei wurde kein Tabellenblatt gefunden.');
  // dates are numbers with a date number format (built-in 14–22 or a custom format with d/m/y)
  const stile = await text('xl/styles.xml');
  const formate = {};
  for (const m of stile.matchAll(/<numFmt [^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) formate[m[1]] = m[2];
  const xfs = (stile.match(/<cellXfs[\s\S]*?<\/cellXfs>/) || [''])[0];
  const datumsStile = new Set();
  [...xfs.matchAll(/<xf [^>]*?numFmtId="(\d+)"/g)].forEach((m, i) => {
    const id = Number(m[1]);
    const code = (formate[m[1]] || '').replace(/"[^"]*"/g, '');
    if ((id >= 14 && id <= 22) || /[dy]/i.test(code)) datumsStile.add(i);
  });

  const zeilen = [];
  for (const z of (await text(blattName)).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const zeile = [];
    for (const c of z[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attr = c[1];
      const inhalt = c[2] || '';
      const ref = (attr.match(/r="([A-Z]+\d+)"/) || [])[1];
      const typ = (attr.match(/t="(\w+)"/) || [])[1];
      const stil = Number((attr.match(/s="(\d+)"/) || [])[1] || -1);
      const v = (inhalt.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let wert = '';
      if (typ === 's') wert = geteilt[Number(v)] || '';
      else if (typ === 'inlineStr') wert = xmlText((inhalt.match(/<is>([\s\S]*?)<\/is>/) || [])[1] || '');
      else if (typ === 'b') wert = v === '1' ? 'ja' : 'nein';
      else if (v !== undefined) wert = datumsStile.has(stil) ? excelDatum(v) : xmlText(v);
      zeile[ref ? spalteNr(ref) : zeile.length] = wert;
    }
    zeilen.push(Array.from(zeile, (x) => x ?? ''));
  }
  return zeilen.filter((z) => z.some((f) => String(f).trim() !== ''));
}

// ---------------------------------------------------------------- mapping

const norm = (s) => String(s).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]/g, '');

const MUSTER = {
  anrede: ['anrede', 'salutation'],
  vorname: ['vorname', 'firstname', 'givenname'],
  nachname: ['nachname', 'name', 'lastname', 'familienname', 'surname'],
  email: ['email', 'mail', 'emailadresse', 'emailaddress'],
  telefon: ['telefon', 'tel', 'telefonnummer', 'handy', 'mobil', 'mobile', 'phone'],
  strasse: ['strasse', 'str', 'strassehausnummer', 'adresse', 'street', 'anschrift'],
  plz: ['plz', 'postleitzahl', 'zip', 'postalcode'],
  ort: ['ort', 'stadt', 'wohnort', 'city'],
  einwilligung_email: ['einwilligung', 'einwilligungemail', 'newsletter', 'werbung', 'emailerlaubt', 'optin'],
  einwilligung_datum: ['einwilligungam', 'einwilligungdatum', 'datumeinwilligung', 'optindatum'],
};

/** Suggests a column index for every target field from the header row. */
export function zuordnungRaten(kopf, zusatzfelder = []) {
  const muster = { ...MUSTER };
  for (const z of zusatzfelder) muster[`zf_${z.key}`] = [norm(z.key), norm(z.label)];
  const spalten = kopf.map(norm);
  const zuordnung = {};
  for (const [ziel, namen] of Object.entries(muster)) {
    const i = spalten.findIndex((s) => namen.includes(s));
    zuordnung[ziel] = i;
  }
  return zuordnung;
}

const JA = new Set(['ja', 'j', 'yes', 'y', 'x', '1', 'true', 'wahr']);

/** Rows + mapping → objects for the import route. */
export function zeilenAufbereiten(zeilen, zuordnung, zusatzfelder = []) {
  const wert = (z, ziel) => (zuordnung[ziel] >= 0 ? String(z[zuordnung[ziel]] ?? '').trim() : '');
  return zeilen.map((z, i) => {
    const o = { nr: i + 2 };
    for (const f of ['anrede', 'vorname', 'nachname', 'email', 'telefon', 'strasse', 'plz', 'ort']) o[f] = wert(z, f);
    o.zusatzfelder = Object.fromEntries(zusatzfelder.map((zf) => [zf.key, wert(z, `zf_${zf.key}`)]).filter(([, v]) => v));
    o.einwilligung_email = zuordnung.einwilligung_email >= 0 && JA.has(wert(z, 'einwilligung_email').toLowerCase());
    o.einwilligung_datum = wert(z, 'einwilligung_datum');
    return o;
  });
}
