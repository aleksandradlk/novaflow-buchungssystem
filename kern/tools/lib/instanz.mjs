// Prepares a backend instance: migrations → start values → optional admin.
// Used by "npm run dev" and the integration tests (later also by deploy/).

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { KERN } from './paths.mjs';
import { buildStartwerte } from './startwerte.mjs';

export const HOOKS_DIR = path.join(KERN, 'pb_hooks');
export const MIGRATIONS_DIR = path.join(KERN, 'pb_migrations');

export function instanceArgs(dataDir) {
  return [`--dir=${dataDir}`, `--hooksDir=${HOOKS_DIR}`, `--migrationsDir=${MIGRATIONS_DIR}`];
}

function run(exe, args, { quiet, env } = {}) {
  return execFileSync(exe, args, { encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit', env: env ?? process.env });
}

/**
 * @param {object} o
 * @param {string} o.exe          backend binary
 * @param {string} o.dataDir      instance data dir
 * @param {object} o.config       validated customer config
 * @param {boolean} [o.ersetzen]  replace existing start values (only without bookings)
 * @param {{email:string,password:string}} [o.superuser]
 * @param {boolean} [o.quiet]
 */
export function prepareInstance({ exe, dataDir, config, ersetzen = false, superuser, quiet = false, env }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const common = instanceArgs(dataDir);
  run(exe, ['migrate', 'up', ...common], { quiet, env });

  const startwerteFile = path.join(path.dirname(dataDir), 'startwerte.json');
  fs.writeFileSync(startwerteFile, JSON.stringify(buildStartwerte(config), null, 2), 'utf8');
  const importArgs = ['nf-startwerte', startwerteFile, ...(ersetzen ? ['ersetzen'] : []), ...common];
  run(exe, importArgs, { quiet, env });

  if (superuser) {
    run(exe, ['superuser', 'upsert', superuser.email, superuser.password, ...common], { quiet, env });
  }
}
