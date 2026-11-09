// npm run dev [-- <kunde>]  – starts a local instance for one customer (default: _beispiel).
//  1. validates kunden/<kunde>/
//  2. provides the pinned backend binary (download + SHA-256 check on first run)
//  3. assembles the web root in .dev/<kunde>/public
//  4. serves everything on 127.0.0.1 only; data lives in .dev/<kunde>/pb_data (git-ignored)

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { DEV_DIR, KERN, ROOT, customerDir } from './lib/paths.mjs';
import { validateCustomer } from './lib/config.mjs';
import { ensurePocketBase } from './lib/pocketbase.mjs';
import { buildPublic } from './lib/public.mjs';

function fail(msg) {
  console.error(`✘ ${msg}`);
  process.exit(1);
}

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const customerId = process.argv[2] || process.env.NF_KUNDE || '_beispiel';
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

const common = [`--dir=${dataDir}`, `--hooksDir=${path.join(KERN, 'pb_hooks')}`, `--migrationsDir=${path.join(KERN, 'pb_migrations')}`];

const { PB_SUPERUSER_EMAIL: suEmail, PB_SUPERUSER_PASSWORD: suPassword } = process.env;
if (suEmail && suPassword) {
  try {
    execFileSync(exe, ['superuser', 'upsert', suEmail, suPassword, ...common], { stdio: 'inherit' });
  } catch {
    fail('Admin-Zugang konnte nicht angelegt werden (PB_SUPERUSER_EMAIL / PB_SUPERUSER_PASSWORD prüfen, Passwort mind. 8 Zeichen).');
  }
}

const base = `http://127.0.0.1:${port}`;
console.log(`
Lokale Instanz „${customerId}“
  Buchungsseite: ${base}/
  Übersicht:     ${base}/uebersicht/
  Admin:         ${base}/_/   (nur lokal; von außen später gesperrt)
Beenden mit Strg+C.
`);

const child = spawn(exe, ['serve', `--http=127.0.0.1:${port}`, `--publicDir=${publicDir}`, ...common], { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code) => process.exit(code ?? 0));
