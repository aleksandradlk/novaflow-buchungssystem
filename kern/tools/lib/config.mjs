// Loads and validates a customer configuration (kunden/<kunde>/):
// 1. JSON schema per file (kern/schema/), 2. cross-file consistency checks.
// Messages are German because they are read by the operator.

import fs from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMA_DIR, customerDir } from './paths.mjs';
import { CONTRAST_PAIRS, contrastRatio } from './branding.mjs';

export const CONFIG_FILES = [
  { key: 'kunde', file: 'kunde.json', schema: 'kunde.schema.json' },
  { key: 'angebote', file: 'angebote.json', schema: 'angebote.schema.json' },
  { key: 'termine', file: 'termine.json', schema: 'termine.schema.json' },
  { key: 'status', file: 'status.json', schema: 'status.schema.json' },
  { key: 'nachrichten', file: 'nachrichten.json', schema: 'nachrichten.schema.json' },
  { key: 'rechtliches', file: 'rechtliches.json', schema: 'rechtliches.schema.json' },
  { key: 'texte', file: 'texte/seiten.json', schema: 'texte.schema.json' },
  { key: 'branding', file: 'branding/branding.json', schema: 'branding.schema.json' },
];

// Module → modules it depends on.
const MODULE_DEPENDENCIES = {
  buchung: ['kapazitaet'],
  nachrichten: ['buchung'],
  kampagne: ['buchung', 'nachrichten'],
  status: ['uebersicht'],
  folgetermin: ['buchung'],
  touren: ['uebersicht'],
};

// Upload limit per booking request (see bodyLimit in kern/pb_hooks/nf.pb.js).
const MAX_UPLOAD_MB = 100;

// Fields every booking form has anyway – extra fields must not reuse these keys.
const STANDARD_FIELDS = ['anrede', 'vorname', 'nachname', 'email', 'telefon', 'strasse', 'plz', 'ort', 'bemerkung', 'notiz', 'fotos'];

let ajvInstance;
function ajv() {
  if (ajvInstance) return ajvInstance;
  ajvInstance = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, strictRequired: false, verbose: true });
  addFormats(ajvInstance);
  for (const name of fs.readdirSync(SCHEMA_DIR).filter((n) => n.endsWith('.schema.json'))) {
    ajvInstance.addSchema(JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, name), 'utf8')));
  }
  return ajvInstance;
}

// ---------------------------------------------------------------- loading

export function loadCustomer(dir) {
  const config = {};
  const errors = [];
  for (const { key, file } of CONFIG_FILES) {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) {
      errors.push(`${file}: Datei fehlt`);
      continue;
    }
    try {
      config[key] = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (e) {
      errors.push(`${file}: kein gültiges JSON (${e.message})`);
    }
  }
  return { config, errors };
}

// ---------------------------------------------------------------- schema errors

const TYPE_DE = { string: 'Text', integer: 'ganze Zahl', number: 'Zahl', boolean: 'true/false', object: 'Objekt', array: 'Liste' };
const FORMAT_DE = { date: 'Datum (JJJJ-MM-TT)', email: 'E-Mail-Adresse', uri: 'URL', hostname: 'Domainname' };

function pointerToPath(pointer) {
  if (!pointer) return '(oberste Ebene)';
  return pointer
    .split('/')
    .slice(1)
    .map((p) => (/^\d+$/.test(p) ? `[${p}]` : `.${p}`))
    .join('')
    .replace(/^\./, '');
}

function describeError(e) {
  const hint = e.parentSchema?.description ? ` – ${e.parentSchema.description}` : '';
  switch (e.keyword) {
    case 'required': return `Pflichtfeld „${e.params.missingProperty}“ fehlt`;
    case 'additionalProperties': return `unbekanntes Feld „${e.params.additionalProperty}“ (Tippfehler?)`;
    case 'type': return `muss vom Typ ${TYPE_DE[e.params.type] ?? e.params.type} sein`;
    case 'enum': return `erlaubt sind nur: ${e.params.allowedValues.map((v) => `„${v}“`).join(', ')}`;
    case 'const': return `muss „${e.params.allowedValue}“ sein`;
    case 'pattern': return e.propertyName
      ? `Schlüssel „${e.propertyName}“ ist ungültig (nur Kleinbuchstaben, Ziffern, _)`
      : `Format ungültig („${e.data}“)${hint}`;
    case 'format': return `ist kein gültiges Format: ${FORMAT_DE[e.params.format] ?? e.params.format} („${e.data}“)`;
    case 'minimum': return `muss mindestens ${e.params.limit} sein`;
    case 'maximum': return `darf höchstens ${e.params.limit} sein`;
    case 'multipleOf': return `muss ein Vielfaches von ${e.params.multipleOf} sein`;
    case 'minLength': return e.params.limit === 1 ? 'darf nicht leer sein' : `braucht mindestens ${e.params.limit} Zeichen`;
    case 'maxLength': return `darf höchstens ${e.params.limit} Zeichen haben`;
    case 'minItems': return `braucht mindestens ${e.params.limit} Eintrag/Einträge`;
    case 'maxItems': return `darf höchstens ${e.params.limit} Einträge haben`;
    case 'uniqueItems': return 'enthält doppelte Einträge';
    case 'minProperties': return `braucht mindestens ${e.params.limit} Eintrag/Einträge`;
    case 'not': return 'Feld ist hier nicht erlaubt (z. B. „optionen“ nur beim Typ „auswahl“)';
    default: return e.message;
  }
}

function schemaErrors(config) {
  const errors = [];
  for (const { key, file, schema } of CONFIG_FILES) {
    if (!(key in config)) continue;
    const validate = ajv().getSchema(schema);
    if (validate(config[key])) continue;
    for (const e of validate.errors) {
      if (e.keyword === 'if' || e.keyword === 'propertyNames') continue;
      errors.push(`${file} › ${pointerToPath(e.instancePath)}: ${describeError(e)}`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------- cross checks

function duplicates(values) {
  const seen = new Set();
  const dup = new Set();
  for (const v of values) (seen.has(v) ? dup : seen).add(v);
  return [...dup];
}

function minutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function crossErrors(c, { dir, folderName }) {
  const errors = [];
  const err = (file, msg) => errors.push(`${file}: ${msg}`);
  const K = c.kunde;
  const M = K.module;
  const angebote = c.angebote.angebote;
  const T = c.termine;
  const status = c.status.status;
  const N = c.nachrichten;
  const R = c.rechtliches;
  const B = c.branding;

  const typCodes = new Set(T.termintypen.map((t) => t.code));
  const ressCodes = new Set(T.ressourcen.map((r) => r.code));

  // kunde.json
  if (folderName && K.kennung !== folderName) {
    err('kunde.json', `„kennung“ (${K.kennung}) muss dem Ordnernamen entsprechen (${folderName})`);
  }
  try {
    new Intl.DateTimeFormat('de-DE', { timeZone: K.zeitzone });
  } catch {
    err('kunde.json', `unbekannte Zeitzone „${K.zeitzone}“`);
  }
  for (const [mod, needs] of Object.entries(MODULE_DEPENDENCIES)) {
    if (!M[mod]) continue;
    for (const n of needs) {
      if (!M[n]) err('kunde.json', `Modul „${mod}“ braucht Modul „${n}“`);
    }
  }
  if (M.touren && K.formular.adresse === 'aus') {
    err('kunde.json', 'Modul „touren“ braucht eine Adresse im Formular (formular.adresse darf nicht „aus“ sein)');
  }
  if (K.formular.fotos.erlaubt && K.formular.fotos.max_anzahl < 1) {
    err('kunde.json', 'formular.fotos.max_anzahl muss mindestens 1 sein, wenn Fotos erlaubt sind');
  }
  if (K.formular.fotos.erlaubt && K.formular.fotos.max_anzahl * K.formular.fotos.max_mb > MAX_UPLOAD_MB) {
    err('kunde.json', `formular.fotos: max_anzahl × max_mb darf höchstens ${MAX_UPLOAD_MB} MB ergeben (Upload-Grenze je Buchung)`);
  }
  const feldKeys = K.formular.zusatzfelder.map((f) => f.key);
  for (const d of duplicates(feldKeys)) err('kunde.json', `Zusatzfeld „${d}“ ist doppelt`);
  for (const k of feldKeys.filter((k) => STANDARD_FIELDS.includes(k))) {
    err('kunde.json', `Zusatzfeld „${k}“ ist bereits ein Standardfeld`);
  }

  // angebote.json
  for (const d of duplicates(angebote.map((a) => a.code))) err('angebote.json', `Angebot „${d}“ ist doppelt`);
  if (!angebote.some((a) => a.aktiv)) err('angebote.json', 'mindestens ein Angebot muss aktiv sein');
  for (const a of angebote) {
    if (!typCodes.has(a.termintyp)) err('angebote.json', `Angebot „${a.code}“: Termintyp „${a.termintyp}“ gibt es nicht in termine.json`);
    if (T.folgetermin && a.termintyp === T.folgetermin.termintyp) {
      err('angebote.json', `Angebot „${a.code}“: „${a.termintyp}“ ist der Folgetermin-Typ und kann nicht direkt gebucht werden`);
    }
    if (a.ressource && !ressCodes.has(a.ressource)) err('angebote.json', `Angebot „${a.code}“: Ressource „${a.ressource}“ gibt es nicht in termine.json`);
    if (a.folgetermin && !M.folgetermin) err('angebote.json', `Angebot „${a.code}“: „folgetermin“ gesetzt, aber Modul „folgetermin“ ist aus`);
    const opts = a.zusatzoptionen ?? [];
    for (const d of duplicates(opts.map((o) => o.code))) err('angebote.json', `Angebot „${a.code}“: Zusatzoption „${d}“ ist doppelt`);
    for (const o of opts) {
      if (o.ressource && !ressCodes.has(o.ressource)) {
        err('angebote.json', `Angebot „${a.code}“, Zusatzoption „${o.code}“: Ressource „${o.ressource}“ gibt es nicht`);
      }
    }
  }

  // termine.json
  if (T.zeitraum.buchbar_ab > T.zeitraum.buchbar_bis) err('termine.json', 'zeitraum: „buchbar_ab“ liegt nach „buchbar_bis“');
  for (const d of duplicates(T.termintypen.map((t) => t.code))) err('termine.json', `Termintyp „${d}“ ist doppelt`);
  for (const d of duplicates(T.ressourcen.map((r) => r.code))) err('termine.json', `Ressource „${d}“ ist doppelt`);
  for (const d of duplicates(T.sperrtage.map((s) => s.datum))) err('termine.json', `Sperrtag ${d} ist doppelt`);
  for (const t of T.termintypen) {
    t.regeln.forEach((r, i) => {
      const where = `Termintyp „${t.code}“, Regel ${i + 1}`;
      const span = minutes(r.bis) - minutes(r.von);
      if (span <= 0) err('termine.json', `${where}: „von“ muss vor „bis“ liegen`);
      else if (span < t.dauer_minuten) err('termine.json', `${where}: Zeitfenster ist kürzer als die Termindauer (${t.dauer_minuten} Min.)`);
      if (r.max_pro_tag !== undefined && r.max_pro_tag < r.max_pro_slot) err('termine.json', `${where}: „max_pro_tag“ ist kleiner als „max_pro_slot“`);
      if (r.gueltig_von && r.gueltig_bis && r.gueltig_von > r.gueltig_bis) err('termine.json', `${where}: „gueltig_von“ liegt nach „gueltig_bis“`);
    });
  }
  if (M.folgetermin && !T.folgetermin) err('termine.json', 'Modul „folgetermin“ ist aktiv, aber „folgetermin“ fehlt');
  if (M.folgetermin && !angebote.some((a) => a.folgetermin)) err('angebote.json', 'Modul „folgetermin“ ist aktiv, aber kein Angebot berechtigt dazu');
  if (T.folgetermin) {
    if (!typCodes.has(T.folgetermin.termintyp)) err('termine.json', `folgetermin: Termintyp „${T.folgetermin.termintyp}“ gibt es nicht`);
    if (T.folgetermin.ab > T.folgetermin.bis) err('termine.json', 'folgetermin: „ab“ liegt nach „bis“');
  }

  // status.json
  for (const d of duplicates(status.map((s) => s.code))) err('status.json', `Status „${d}“ ist doppelt`);
  const starts = status.filter((s) => s.start);
  if (starts.length !== 1) err('status.json', `genau ein Status braucht „start“: true (gefunden: ${starts.length})`);
  if (M.loeschung && !status.some((s) => s.abschluss)) err('status.json', 'Modul „loeschung“ braucht mindestens einen Status mit „abschluss“: true');
  for (const s of status) {
    if (s.start && s.abschluss) err('status.json', `Status „${s.code}“ kann nicht gleichzeitig Start und Abschluss sein`);
  }

  // nachrichten.json
  const fenster = N.kampagne.versandfenster;
  if (minutes(fenster.von) >= minutes(fenster.bis)) err('nachrichten.json', 'kampagne.versandfenster: „von“ muss vor „bis“ liegen');

  // rechtliches.json
  for (const d of duplicates(R.einwilligungen.map((e) => e.kanal))) err('rechtliches.json', `Einwilligung für Kanal „${d}“ ist doppelt`);
  if (M.kampagne && !R.einwilligungen.some((e) => e.kanal === 'email')) {
    err('rechtliches.json', 'Modul „kampagne“ braucht einen Einwilligungstext für Kanal „email“');
  }

  // texte/seiten.json
  const duKeys = Object.keys(c.texte.du).sort();
  const sieKeys = Object.keys(c.texte.sie).sort();
  for (const k of duKeys.filter((k) => !sieKeys.includes(k))) err('texte/seiten.json', `Text „${k}“ fehlt in der Sie-Variante`);
  for (const k of sieKeys.filter((k) => !duKeys.includes(k))) err('texte/seiten.json', `Text „${k}“ fehlt in der du-Variante`);

  // branding/branding.json
  const bfile = 'branding/branding.json';
  const brandingDir = path.join(dir, 'branding');
  const logoPath = path.join(brandingDir, B.logo);
  if (!fs.existsSync(logoPath)) {
    err(bfile, `Logo-Datei „${B.logo}“ fehlt im Ordner branding/`);
  } else if (B.logo.endsWith('.svg')) {
    const svg = fs.readFileSync(logoPath, 'utf8');
    const external = svg.replace(/xmlns(:\w+)?="http:\/\/www\.w3\.org\/[^"]*"/g, '');
    if (/<script/i.test(svg)) err(bfile, 'Logo-SVG darf kein <script> enthalten');
    if (/(href|src)\s*=\s*["']\s*(https?:)?\/\//i.test(external) || /url\(\s*["']?\s*(https?:)?\/\//i.test(external)) {
      err(bfile, 'Logo-SVG lädt externe Inhalte – alles muss lokal sein');
    }
  }
  const { familie, dateien } = B.schrift;
  if (familie === 'system' && dateien.length > 0) err(bfile, 'Schrift „system“ braucht keine Schriftdateien');
  if (familie !== 'system' && dateien.length === 0) err(bfile, `Schrift „${familie}“: Schriftdateien (WOFF2) fehlen – Schriften müssen lokal mitgeliefert werden oder „system“ sein`);
  for (const f of dateien) {
    if (!fs.existsSync(path.join(brandingDir, f.datei))) err(bfile, `Schriftdatei „${f.datei}“ fehlt im Ordner branding/`);
  }
  for (const [vorne, hinten] of CONTRAST_PAIRS) {
    const ratio = contrastRatio(B.farben[vorne], B.farben[hinten]);
    if (ratio < 4.5) {
      err(bfile, `Kontrast „${vorne}“ auf „${hinten}“ ist zu gering (${ratio.toFixed(2)}:1, nötig 4.5:1)`);
    }
  }

  return errors;
}

// ---------------------------------------------------------------- public API

/** Validates an already loaded config object. `dir` is needed for file checks (logo, fonts). */
export function validateConfig(config, { dir, folderName } = {}) {
  const errors = schemaErrors(config);
  if (errors.length > 0) return errors; // cross checks assume a valid structure
  return crossErrors(config, { dir, folderName });
}

/** Loads and validates kunden/<customerId>/. Returns { config, errors }. */
export function validateCustomer(customerId) {
  const dir = customerDir(customerId);
  if (!fs.existsSync(dir)) return { config: null, errors: [`Ordner kunden/${customerId}/ gibt es nicht`] };
  const { config, errors } = loadCustomer(dir);
  if (errors.length > 0) return { config, errors };
  return { config, errors: validateConfig(config, { dir, folderName: customerId }) };
}
