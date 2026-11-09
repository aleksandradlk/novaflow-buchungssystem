// npm run check [-- <kunde> ...]  – validates customer configurations (all if none given).
import fs from 'node:fs';
import { KUNDEN } from './lib/paths.mjs';
import { validateCustomer } from './lib/config.mjs';

const requested = process.argv.slice(2);
const customers = requested.length > 0
  ? requested
  : fs.readdirSync(KUNDEN, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();

let failed = 0;
for (const id of customers) {
  let errors;
  try {
    ({ errors } = validateCustomer(id));
  } catch (e) {
    errors = [e.message];
  }
  if (errors.length === 0) {
    console.log(`✔ ${id}: Konfiguration gültig`);
  } else {
    failed += 1;
    console.log(`✘ ${id}: ${errors.length} Fehler`);
    for (const e of errors) console.log(`   – ${e}`);
  }
}
process.exit(failed > 0 ? 1 : 0);
