// Provides the pinned backend binary (version + SHA-256 from kern/pocketbase-version.json).
// The binary is downloaded once into .dev/bin/ and never committed.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import AdmZip from 'adm-zip';
import { DEV_DIR, KERN } from './paths.mjs';

export function readVersionPin() {
  return JSON.parse(fs.readFileSync(path.join(KERN, 'pocketbase-version.json'), 'utf8'));
}

const OS = { linux: 'linux', darwin: 'darwin', win32: 'windows' };
const ARCH = { x64: 'amd64', arm64: 'arm64' };

export function platformKey(platform = process.platform, arch = process.arch) {
  const os = OS[platform];
  const cpu = ARCH[arch];
  if (!os || !cpu) {
    throw new Error(`Plattform ${platform}/${arch} wird nicht unterstützt (unterstützt: Linux, Windows, macOS auf x64 oder arm64).`);
  }
  return `${os}_${cpu}`;
}

function binaryName(key) {
  return key.startsWith('windows') ? 'pocketbase.exe' : 'pocketbase';
}

function installedVersion(exe) {
  try {
    return execFileSync(exe, ['--version'], { encoding: 'utf8' }).trim().split(/\s+/).pop();
  } catch {
    return null;
  }
}

async function download(url) {
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    const hint = process.env.HTTPS_PROXY && !process.env.NODE_USE_ENV_PROXY
      ? ' Hinter einem Proxy: Umgebungsvariable NODE_USE_ENV_PROXY=1 setzen.'
      : '';
    throw new Error(`Download fehlgeschlagen (${e.cause?.code ?? e.message}).${hint}`);
  }
  if (!res.ok) throw new Error(`Download fehlgeschlagen: HTTP ${res.status} für ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Returns the path to the verified binary, downloading it if needed. */
export async function ensurePocketBase({ log = console.log } = {}) {
  const pin = readVersionPin();
  const key = platformKey();
  const expected = pin.sha256[key];
  if (!expected) throw new Error(`Keine Prüfsumme für ${key} in kern/pocketbase-version.json.`);

  const dir = path.join(DEV_DIR, 'bin', `pocketbase-${pin.version}-${key}`);
  const exe = path.join(dir, binaryName(key));
  if (fs.existsSync(exe) && installedVersion(exe) === pin.version) return exe;

  const url = `https://github.com/pocketbase/pocketbase/releases/download/v${pin.version}/pocketbase_${pin.version}_${key}.zip`;
  log(`Lade Backend v${pin.version} (${key}) …`);
  const zip = await download(url);
  const actual = crypto.createHash('sha256').update(zip).digest('hex');
  if (actual !== expected) {
    throw new Error(`Prüfsumme stimmt nicht (erwartet ${expected}, erhalten ${actual}). Download verworfen.`);
  }

  const entry = new AdmZip(zip).getEntry(binaryName(key));
  if (!entry) throw new Error(`${binaryName(key)} fehlt im heruntergeladenen Archiv.`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(exe, entry.getData(), { mode: 0o755 });

  const v = installedVersion(exe);
  if (v !== pin.version) throw new Error(`Installierte Version ${v} entspricht nicht dem Pin ${pin.version}.`);
  log(`Backend v${v} geprüft (SHA-256 ok).`);
  return exe;
}
