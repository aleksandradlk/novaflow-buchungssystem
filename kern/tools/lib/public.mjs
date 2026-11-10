// Assembles the static web root of one customer instance:
//   kern/web/buchung    → /
//   kern/web/uebersicht → /uebersicht/
//   kern/web/gemeinsam  → /gemeinsam/
//   kunden/<kunde>/branding (+ generated branding.css) → /kunde/

import fs from 'node:fs';
import path from 'node:path';
import { WEB_DIR } from './paths.mjs';
import { brandingCss, fontFileUrl } from './branding.mjs';

const SKIP = new Set(['.gitkeep']);

function copyDir(from, to) {
  fs.cpSync(from, to, {
    recursive: true,
    filter: (src) => !SKIP.has(path.basename(src)),
  });
}

export function buildPublic({ customerDirPath, branding, outDir }) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  copyDir(path.join(WEB_DIR, 'buchung'), outDir);
  copyDir(path.join(WEB_DIR, 'uebersicht'), path.join(outDir, 'uebersicht'));
  copyDir(path.join(WEB_DIR, 'gemeinsam'), path.join(outDir, 'gemeinsam'));

  const kundeOut = path.join(outDir, 'kunde');
  const brandingDir = path.join(customerDirPath, 'branding');
  fs.mkdirSync(path.join(kundeOut, 'schriften'), { recursive: true });
  fs.copyFileSync(path.join(brandingDir, branding.logo), path.join(kundeOut, branding.logo));
  for (const f of branding.schrift.dateien) {
    fs.copyFileSync(path.join(brandingDir, f.datei), path.join(kundeOut, fontFileUrl(f.datei)));
  }
  fs.writeFileSync(path.join(kundeOut, 'branding.css'), brandingCss(branding), 'utf8');
  return outDir;
}
