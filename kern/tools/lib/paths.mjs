import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const KERN = path.join(ROOT, 'kern');
export const KUNDEN = path.join(ROOT, 'kunden');
export const SCHEMA_DIR = path.join(KERN, 'schema');
export const WEB_DIR = path.join(KERN, 'web');
export const DEV_DIR = path.join(ROOT, '.dev');

// Same rule as "kennung" in kunde.schema.json – also prevents path traversal.
export const CUSTOMER_ID_PATTERN = /^_?[a-z0-9][a-z0-9-]{1,39}$/;

export function customerDir(customerId) {
  if (!CUSTOMER_ID_PATTERN.test(customerId)) {
    throw new Error(`Ungültige Kundenkennung „${customerId}“ (erlaubt: Kleinbuchstaben, Ziffern, Bindestrich, optional mit _ am Anfang).`);
  }
  return path.join(KUNDEN, customerId);
}
