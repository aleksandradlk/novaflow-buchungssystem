// Unit tests for the n8n generator (kern/tools/lib/n8n.mjs) – no n8n needed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testKonfiguration } from './hilfen.mjs';
import { EREIGNISSE, buildCredentials, buildWorkflows, kennungen } from '../lib/n8n.mjs';

const config = testKonfiguration();
const wfs = buildWorkflows({ config, pbUrl: 'http://127.0.0.1:8090/', telegramChatId: '42' });
const nachName = Object.fromEntries(wfs.map((w) => [w.name.split(' · ')[1], w]));

test('sechs Workflows: Mail senden, drei Ereignisse, Erinnerungen, Nachholen – alle aktiv', () => {
  assert.deepEqual(Object.keys(nachName).sort(), ['Mail senden', ...EREIGNISSE, 'erinnerungen', 'nachholen'].sort());
  assert.ok(wfs.every((w) => w.active === true));
});

test('alle Platzhalter gefüllt, keine Secrets in den Workflows', () => {
  const text = JSON.stringify(wfs);
  assert.doesNotMatch(text, /%%/);
  assert.doesNotMatch(text, /password|clientSecret|accessToken|test-geheimnis/i);
  assert.match(text, /http:\/\/127\.0\.0\.1:8090\/api\/nf-intern\/versand\/start/);
});

test('IDs sind stabil und eindeutig; alle Aufrufe zeigen auf „Mail senden“', () => {
  const nochmal = buildWorkflows({ config, pbUrl: 'http://x' });
  assert.deepEqual(wfs.map((w) => w.id), nochmal.map((w) => w.id));
  assert.equal(new Set(wfs.map((w) => w.id)).size, wfs.length);
  const ziel = nachName['Mail senden'].id;
  for (const w of wfs.filter((x) => x !== nachName['Mail senden'])) {
    const aufruf = w.nodes.find((n) => n.type === 'n8n-nodes-base.executeWorkflow');
    assert.equal(aufruf.parameters.workflowId.value, ziel, w.name);
  }
});

test('Webhooks: Pfad mit Kundenkennung, nur mit geheimem Header', () => {
  for (const w of wfs) {
    for (const n of w.nodes.filter((x) => x.type === 'n8n-nodes-base.webhook')) {
      assert.match(n.parameters.path, /^_beispiel\//);
      assert.equal(n.parameters.authentication, 'headerAuth');
      assert.equal(n.credentials.httpHeaderAuth.id, kennungen('_beispiel').secret);
      assert.ok(n.webhookId);
    }
  }
});

test('Datensparsam: erfolgreiche Ausführungen werden nicht gespeichert', () => {
  assert.ok(wfs.every((w) => w.settings.saveDataSuccessExecution === 'none'));
  assert.ok(wfs.every((w) => w.settings.timezone === 'Europe/Berlin'));
});

test('Zugangsdaten nur, wenn die Werte gesetzt sind; Telegram gemeinsam für alle Kunden', () => {
  assert.deepEqual(buildCredentials({ config, env: {} }), []);
  const alle = buildCredentials({
    config,
    env: { NF_WEBHOOK_SECRET: 's', SMTP_HOST: 'h', GRAPH_TENANT_ID: 't', GRAPH_CLIENT_ID: 'c', GRAPH_CLIENT_SECRET: 'x', TELEGRAM_BOT_TOKEN: 'b' },
  });
  assert.deepEqual(alle.map((c) => c.type), ['httpHeaderAuth', 'smtp', 'oAuth2Api', 'telegramApi']);
  const graph = alle.find((c) => c.type === 'oAuth2Api');
  assert.equal(graph.data.grantType, 'clientCredentials');
  assert.equal(graph.data.accessTokenUrl, 'https://login.microsoftonline.com/t/oauth2/v2.0/token');
  assert.equal(graph.data.scope, 'https://graph.microsoft.com/.default');
  assert.equal(kennungen('a').telegram, kennungen('b').telegram);
  assert.notEqual(kennungen('a').secret, kennungen('b').secret);
});
