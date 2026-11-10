// Builds the n8n import files of one customer from the templates in kern/n8n/.
// IDs are derived from the customer id, so re-importing replaces instead of duplicating.
// Credentials are built from environment variables only (never stored in the repo).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { KERN } from './paths.mjs';

const VORLAGEN = path.join(KERN, 'n8n');
export const EREIGNISSE = ['neue-buchung', 'verschoben-abgesagt', 'status'];
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function hash(text) {
  return crypto.createHash('sha256').update(text).digest();
}

/** Stable 16-char id (n8n style) for a customer + purpose. */
export function stabileId(kunde, zweck) {
  const h = hash(`nf:${kunde}:${zweck}`);
  let id = '';
  for (let i = 0; i < 16; i++) id += ALPHABET[h[i] % ALPHABET.length];
  return id;
}

function stabileUuid(kunde, zweck) {
  const h = hash(`nf-uuid:${kunde}:${zweck}`).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function kennungen(kunde) {
  return {
    workflow: (name) => stabileId(kunde, `workflow:${name}`),
    secret: stabileId(kunde, 'cred:secret'),
    smtp: stabileId(kunde, 'cred:smtp'),
    graph: stabileId(kunde, 'cred:graph'),
    // one Telegram bot for all customers (NovaFlow's own alerts)
    telegram: stabileId('novaflow', 'cred:telegram'),
  };
}

function fuellen(datei, werte) {
  let text = fs.readFileSync(path.join(VORLAGEN, datei), 'utf8');
  for (const [k, v] of Object.entries(werte)) {
    text = text.split(`%%${k}%%`).join(JSON.stringify(String(v)).slice(1, -1));
  }
  const rest = text.match(/%%[A-Z_]+%%/);
  if (rest) throw new Error(`Platzhalter ${rest[0]} in kern/n8n/${datei} ist nicht belegt.`);
  return JSON.parse(text);
}

/**
 * @param {object} o
 * @param {object} o.config        validated customer config
 * @param {string} o.pbUrl         URL of the customer's instance as seen from n8n (e.g. http://127.0.0.1:8090)
 * @param {string} [o.graphApiUrl] Microsoft Graph base URL (tests use a local mock)
 * @param {string} [o.telegramChatId]
 */
export function buildWorkflows({ config, pbUrl, graphApiUrl = 'https://graph.microsoft.com', telegramChatId = '' }) {
  const kunde = config.kunde.kennung;
  const ids = kennungen(kunde);
  const werte = {
    KUNDE: kunde,
    PB_URL: pbUrl.replace(/\/+$/, ''),
    ZEITZONE: config.kunde.zeitzone,
    GRAPH_API_URL: graphApiUrl.replace(/\/+$/, ''),
    TELEGRAM_CHAT_ID: telegramChatId,
    ID_MAIL_SENDEN: ids.workflow('mail-senden'),
    CRED_SECRET: ids.secret,
    CRED_SMTP: ids.smtp,
    CRED_GRAPH: ids.graph,
    CRED_TELEGRAM: ids.telegram,
  };

  const liste = [['mail-senden', fuellen('mail-senden.json', werte)]];
  for (const ereignis of EREIGNISSE) liste.push([ereignis, fuellen('ereignis.json', { ...werte, EREIGNIS: ereignis })]);
  liste.push(['erinnerungen', fuellen('erinnerungen.json', werte)]);
  liste.push(['nachholen', fuellen('nachholen.json', werte)]);

  return liste.map(([name, wf]) => {
    wf.id = ids.workflow(name);
    for (const node of wf.nodes) {
      node.id = stabileUuid(kunde, `${name}:${node.name}`);
      if (node.type === 'n8n-nodes-base.webhook') node.webhookId = stabileUuid(kunde, `${name}:${node.name}:webhook`);
    }
    return wf;
  });
}

/**
 * Credentials for n8n from environment variables. Only credentials whose values are
 * present are returned. The resulting file contains secrets: keep it out of the repo
 * and delete it after the import.
 */
export function buildCredentials({ config, env }) {
  const kunde = config.kunde.kennung;
  const ids = kennungen(kunde);
  const liste = [];
  if (env.NF_WEBHOOK_SECRET) {
    liste.push({ id: ids.secret, name: `NF ${kunde} Secret`, type: 'httpHeaderAuth', data: { name: 'X-NF-Secret', value: env.NF_WEBHOOK_SECRET } });
  }
  if (env.SMTP_HOST) {
    liste.push({
      id: ids.smtp,
      name: `NF ${kunde} SMTP`,
      type: 'smtp',
      data: {
        host: env.SMTP_HOST,
        port: Number(env.SMTP_PORT || 587),
        user: env.SMTP_USER || '',
        password: env.SMTP_PASSWORD || '',
        secure: env.SMTP_SECURE === 'true',
        disableStartTls: env.SMTP_STARTTLS === 'false',
      },
    });
  }
  if (env.GRAPH_TENANT_ID && env.GRAPH_CLIENT_ID && env.GRAPH_CLIENT_SECRET) {
    const login = (env.NF_GRAPH_LOGIN_URL || 'https://login.microsoftonline.com').replace(/\/+$/, '');
    liste.push({
      id: ids.graph,
      name: `NF ${kunde} Microsoft 365`,
      type: 'oAuth2Api',
      data: {
        grantType: 'clientCredentials',
        accessTokenUrl: `${login}/${env.GRAPH_TENANT_ID}/oauth2/v2.0/token`,
        clientId: env.GRAPH_CLIENT_ID,
        clientSecret: env.GRAPH_CLIENT_SECRET,
        scope: 'https://graph.microsoft.com/.default',
        authentication: 'body',
      },
    });
  }
  if (env.TELEGRAM_BOT_TOKEN) {
    liste.push({
      id: ids.telegram,
      name: 'NF Telegram',
      type: 'telegramApi',
      data: { accessToken: env.TELEGRAM_BOT_TOKEN, baseUrl: (env.NF_TELEGRAM_API_URL || 'https://api.telegram.org').replace(/\/+$/, '') },
    });
  }
  return liste;
}
