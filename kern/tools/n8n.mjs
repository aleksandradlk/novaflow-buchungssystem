// npm run n8n [-- <kunde>] [--env <datei>] [--ziel <ordner>]
// Writes the n8n import files of one customer to .dev/<kunde>/n8n/ (or --ziel):
//   workflows.json    – always (no secrets)
//   credentials.json  – only if the secrets are set in .env (contains secrets: delete after import!)

import fs from 'node:fs';
import path from 'node:path';
import { DEV_DIR, ROOT } from './lib/paths.mjs';
import { validateCustomer } from './lib/config.mjs';
import { buildCredentials, buildWorkflows } from './lib/n8n.mjs';

function option(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

// on the server: --env /etc/novaflow/<instanz>.env (deploy/neuer-kunde.sh)
const envFile = option('--env') ?? path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
else if (option('--env')) {
  console.error(`✘ ${envFile} gibt es nicht.`);
  process.exit(1);
}

const erstes = process.argv[2];
const kunde = (erstes && !erstes.startsWith('--') ? erstes : undefined) || process.env.NF_KUNDE || '_beispiel';
const { config, errors } = validateCustomer(kunde);
if (errors.length) {
  console.error(`✘ kunden/${kunde}: Konfiguration ungültig`);
  for (const e of errors) console.error(`   – ${e}`);
  process.exit(1);
}

const pbUrl = process.env.NF_PB_URL || `http://127.0.0.1:${process.env.PB_PORT || 8090}`;
const anzeige = (p) => (p.startsWith(ROOT + path.sep) ? path.relative(ROOT, p) : p);
const ziel = path.resolve(option('--ziel') ?? path.join(DEV_DIR, kunde, 'n8n'));
fs.mkdirSync(ziel, { recursive: true, mode: 0o700 });

const workflows = buildWorkflows({
  config,
  pbUrl,
  graphApiUrl: process.env.NF_GRAPH_API_URL,
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
});
fs.writeFileSync(path.join(ziel, 'workflows.json'), JSON.stringify(workflows, null, 2));
console.log(`✔ ${workflows.length} Workflows → ${anzeige(path.join(ziel, 'workflows.json'))}`);

const credentials = buildCredentials({ config, env: process.env });
const credFile = path.join(ziel, 'credentials.json');
if (credentials.length) {
  fs.writeFileSync(credFile, JSON.stringify(credentials, null, 2), { mode: 0o600 });
  console.log(`✔ ${credentials.length} Zugangsdaten → ${anzeige(credFile)} (enthält Secrets – nach dem Import löschen!)`);
} else {
  console.log('ℹ Keine Secrets in .env – Zugangsdaten bitte in n8n anlegen (Namen siehe README).');
}
for (const fehlt of ['NF_WEBHOOK_SECRET', 'SMTP_HOST', 'GRAPH_TENANT_ID', 'TELEGRAM_BOT_TOKEN'].filter((k) => !process.env[k])) {
  console.log(`  – ${fehlt} nicht gesetzt`);
}

// Order tested with n8n 2.46.7 (kern/tools/test/mails.test.mjs): import, publish, restart.
console.log(`
Import in n8n (Reihenfolge wie im Test erprobt):
  n8n import:credentials --input=${credFile}
  n8n import:workflow --input=${path.join(ziel, 'workflows.json')}
${workflows.filter((w) => w.active).map((w) => `  n8n publish:workflow --id=${w.id}   # ${w.name}`).join('\n')}
  danach n8n neu starten (veröffentlichte Workflows werden beim Start aktiv)`);
