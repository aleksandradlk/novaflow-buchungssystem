// node kern/tools/instanz-bauen.mjs <kunde> --ziel <ordner> [--bin <ordner>]
// Builds everything one server instance runs, into a fresh folder (used by deploy/*.sh):
//   <ziel>/pocketbase       pinned backend binary (SHA-256 checked; cached in --bin)
//   <ziel>/pb_hooks/        kern/pb_hooks
//   <ziel>/pb_migrations/   kern/pb_migrations
//   <ziel>/public/          web root (pages + branding of kunden/<kunde>/)
//   <ziel>/startwerte.json  start values from kunden/<kunde>/
//   <ziel>/version.json     template commit + backend version (for support and backups)
// The folder is built next to the running one and swapped in by deploy/ausrollen.sh,
// so a broken build never touches the running instance.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, customerDir } from './lib/paths.mjs';
import { validateCustomer } from './lib/config.mjs';
import { ensurePocketBase, readVersionPin } from './lib/pocketbase.mjs';
import { buildPublic } from './lib/public.mjs';
import { buildStartwerte } from './lib/startwerte.mjs';
import { HOOKS_DIR, MIGRATIONS_DIR } from './lib/instanz.mjs';

function fail(msg) {
  console.error(`✘ ${msg}`);
  process.exit(1);
}

function option(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const kunde = process.argv[2];
const ziel = option('--ziel');
const binDir = option('--bin');
if (!kunde || kunde.startsWith('--') || !ziel) fail('Aufruf: instanz-bauen.mjs <kunde> --ziel <ordner> [--bin <ordner>]');

let dir;
try {
  dir = customerDir(kunde);
} catch (e) {
  fail(e.message);
}
if (!fs.existsSync(dir)) fail(`kunden/${kunde} gibt es nicht.`);

const { config, errors } = validateCustomer(kunde);
if (errors.length) {
  console.error(`✘ kunden/${kunde}: Konfiguration ungültig`);
  for (const e of errors) console.error(`   – ${e}`);
  process.exit(1);
}

let exe;
try {
  exe = await ensurePocketBase({ ...(binDir ? { binDir } : {}) });
} catch (e) {
  fail(e.message);
}

const out = path.resolve(ziel);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

fs.copyFileSync(exe, path.join(out, 'pocketbase'));
fs.chmodSync(path.join(out, 'pocketbase'), 0o755);
fs.cpSync(HOOKS_DIR, path.join(out, 'pb_hooks'), { recursive: true });
fs.cpSync(MIGRATIONS_DIR, path.join(out, 'pb_migrations'), { recursive: true });
buildPublic({ customerDirPath: dir, branding: config.branding, outDir: path.join(out, 'public') });
fs.writeFileSync(path.join(out, 'startwerte.json'), JSON.stringify(buildStartwerte(config), null, 2), 'utf8');

let commit = null;
try {
  commit = execFileSync('git', ['-C', ROOT, 'rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch {
  // not a git checkout (e.g. copied folder) – version.json then has no commit
}
const version = { kunde, vorlage: commit, backend: readVersionPin().version, gebaut_am: new Date().toISOString() };
fs.writeFileSync(path.join(out, 'version.json'), JSON.stringify(version, null, 2) + '\n', 'utf8');

console.log(`✔ Instanz-Dateien für „${kunde}“ gebaut (Vorlage ${commit ?? 'ohne git'}, Backend v${version.backend})`);
