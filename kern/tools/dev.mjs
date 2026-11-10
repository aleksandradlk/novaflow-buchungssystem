// npm run dev [-- <kunde>] [-- --startwerte-neu]
// Starts a local instance for one customer (default: _beispiel).
//  1. validates kunden/<kunde>/
//  2. provides the pinned backend binary (download + SHA-256 check on first run)
//  3. assembles the web root in .dev/<kunde>/public
//  4. applies migrations and imports the start values (once; --startwerte-neu replaces them
//     as long as there are no bookings)
//  5. serves everything on 127.0.0.1 only; data lives in .dev/<kunde>/pb_data (git-ignored)

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DEV_DIR, ROOT, customerDir } from './lib/paths.mjs';
import { validateCustomer } from './lib/config.mjs';
import { ensurePocketBase } from './lib/pocketbase.mjs';
import { buildPublic } from './lib/public.mjs';
import { instanceArgs, prepareInstance } from './lib/instanz.mjs';

function fail(msg) {
  console.error(`✘ ${msg}`);
  process.exit(1);
}

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const args = process.argv.slice(2);
const startwerteNeu = args.includes('--startwerte-neu');
const customerId = args.find((a) => !a.startsWith('--')) || process.env.NF_KUNDE || '_beispiel';
const port = Number(process.env.PB_PORT || 8090);
if (!Number.isInteger(port) || port < 1024 || port > 65535) fail(`PB_PORT „${process.env.PB_PORT}“ ist kein gültiger Port (1024–65535).`);

let dir;
try {
  dir = customerDir(customerId);
} catch (e) {
  fail(e.message);
}

const { config, errors } = validateCustomer(customerId);
if (errors.length > 0) {
  console.error(`✘ kunden/${customerId}: Konfiguration ungültig`);
  for (const e of errors) console.error(`   – ${e}`);
  process.exit(1);
}
console.log(`✔ kunden/${customerId}: Konfiguration gültig`);

let exe;
try {
  exe = await ensurePocketBase();
} catch (e) {
  fail(e.message);
}

const instanceDir = path.join(DEV_DIR, customerId);
const dataDir = path.join(instanceDir, 'pb_data');
const publicDir = buildPublic({ customerDirPath: dir, branding: config.branding, outDir: path.join(instanceDir, 'public') });

const common = instanceArgs(dataDir);

const { PB_SUPERUSER_EMAIL: suEmail, PB_SUPERUSER_PASSWORD: suPassword } = process.env;
try {
  prepareInstance({
    exe,
    dataDir,
    config,
    ersetzen: startwerteNeu,
    superuser: suEmail && suPassword ? { email: suEmail, password: suPassword } : undefined,
  });
} catch {
  fail('Instanz konnte nicht vorbereitet werden (Meldung oben). Bei Admin-Zugang: Passwort mind. 8 Zeichen.');
}
if (!process.env.NF_WEBHOOK_URL) {
  console.log('Hinweis: NF_WEBHOOK_URL ist nicht gesetzt – Benachrichtigungen an die Automationen werden übersprungen.');
}

const base = `http://127.0.0.1:${port}`;
// links in mails point to the local instance unless set otherwise
process.env.NF_OEFFENTLICHE_URL ||= base;
// local only: login codes for the overview are also printed to this console
process.env.NF_DEV = '1';
// local only: admin UI without second factor (on the server it is always on)
process.env.NF_SUPERUSER_2FA ??= '0';
console.log(`
Lokale Instanz „${customerId}“
  Buchungsseite: ${base}/
  Übersicht:     ${base}/uebersicht/
  Admin:         ${base}/_/   (nur lokal; von außen später gesperrt)
Konfiguration geändert? Neu einlesen mit: npm run dev -- ${customerId} --startwerte-neu
Beenden mit Strg+C.
`);

const child = spawn(exe, ['serve', `--http=127.0.0.1:${port}`, `--publicDir=${publicDir}`, ...common], { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code) => process.exit(code ?? 0));
