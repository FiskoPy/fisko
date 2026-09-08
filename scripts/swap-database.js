#!/usr/bin/env node
/**
 * Points the deployed API at a different Postgres, and redeploys.
 *
 * The free Render Postgres expires 30 days after creation (this one:
 * 2026-09-11T14:24Z) and the instance stops serving when it goes. Migrations
 * run on boot — the Dockerfile calls `prisma migrate deploy` before start — so
 * a fresh, empty database becomes a working one with no extra step.
 *
 * This does NOT copy data. The client chose to start fresh (2026-09-06); the
 * invoices already imported are test data he is willing to lose. If that ever
 * changes, the Render database has to be opened to external connections first
 * (its IP allow-list is empty), which is a dashboard setting.
 *
 * Usage:
 *   node scripts/swap-database.js --url "postgresql://user:pass@host:5432/db"
 *   node scripts/swap-database.js --new-render-free      (creates one and uses it)
 *   node scripts/swap-database.js --show                 (prints current state)
 *
 * The Render API key is read from RENDER_API_KEY, or from the file given by
 * --key-file. It is never written to the repo.
 */
const fs = require('node:fs');
const path = require('node:path');

const SERVICE = 'srv-d9u855dbedkc738vs460';
const OWNER = 'tea-d9tn99m417fc73erdsj0';

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
}
const flag = (name) => process.argv.includes('--' + name);

function apiKey() {
  if (process.env.RENDER_API_KEY) return process.env.RENDER_API_KEY.trim();
  const file = arg('key-file', null);
  if (file && fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  console.error(
    '\nFalta a chave da Render. Use RENDER_API_KEY=... ou --key-file <arquivo>.\n',
  );
  process.exit(1);
}

const KEY = apiKey();
const H = {
  authorization: 'Bearer ' + KEY,
  accept: 'application/json',
  'content-type': 'application/json',
};

async function api(method, url, body) {
  const res = await fetch('https://api.render.com/v1' + url, {
    method,
    headers: H,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* some endpoints answer empty */
  }
  if (!res.ok) {
    throw new Error(`${method} ${url} → ${res.status} ${text.slice(0, 300)}`);
  }
  return data;
}

async function showState() {
  const dbs = await api('GET', '/postgres?limit=20');
  console.log('\nBancos na conta:');
  for (const it of dbs) {
    const p = it.postgres || it;
    const days = p.expiresAt
      ? Math.round((new Date(p.expiresAt) - Date.now()) / 86400000)
      : null;
    console.log(
      `  ${p.name}  plano=${p.plan}  status=${p.status}` +
        (p.expiresAt ? `  expira em ${days} dia(s) (${p.expiresAt})` : '  sem expiração'),
    );
  }
  const vars = await api('GET', `/services/${SERVICE}/env-vars?limit=50`);
  const cur = vars.map((it) => it.envVar || it).find((e) => e.key === 'DATABASE_URL');
  // Print only the host: the rest is a credential.
  const host = cur ? (cur.value.match(/@([^/]+)/) || [])[1] : '(ausente)';
  console.log(`\nDATABASE_URL do serviço aponta para: ${host}`);
}

/** Creates a fresh free Postgres on Render and returns its internal URL. */
async function createRenderFree() {
  const name = 'fisko-db-' + new Date().toISOString().slice(0, 10).replace(/-/g, '');
  console.log(`Criando banco gratuito "${name}"...`);
  const db = await api('POST', '/postgres', {
    name,
    ownerId: OWNER,
    plan: 'free',
    region: 'oregon',
    version: '16',
  });
  const id = db.id || db.postgres?.id;

  process.stdout.write('aguardando ficar disponível');
  for (let i = 0; i < 60; i++) {
    const p = await api('GET', `/postgres/${id}`);
    const status = p.status || p.postgres?.status;
    if (status === 'available') {
      console.log(' ok');
      const conn = await api('GET', `/postgres/${id}/connection-info`);
      return conn.internalConnectionString || conn.externalConnectionString;
    }
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error('o banco não ficou disponível a tempo');
}

async function swap(databaseUrl) {
  if (!/^postgres(ql)?:\/\/.+@.+\/.+/.test(databaseUrl)) {
    throw new Error('A connection string não parece válida: ' + databaseUrl.slice(0, 40));
  }

  const vars = (await api('GET', `/services/${SERVICE}/env-vars?limit=50`)).map(
    (it) => it.envVar || it,
  );
  const before = vars.find((e) => e.key === 'DATABASE_URL');
  console.log('DATABASE_URL anterior:', (before?.value.match(/@([^/]+)/) || [])[1] ?? '(ausente)');

  // PUT replaces the whole set, so send everything back with only this changed.
  // Losing EMAIL_CRYPTO_KEY here would make every stored mailbox password
  // undecryptable, so the count is checked rather than assumed.
  const body = vars.map((e) => ({
    key: e.key,
    value: e.key === 'DATABASE_URL' ? databaseUrl : e.value,
  }));
  if (body.length < 10) {
    throw new Error(`Só ${body.length} variáveis lidas — recusando escrever um conjunto truncado.`);
  }
  await api('PUT', `/services/${SERVICE}/env-vars`, body);
  console.log(`DATABASE_URL trocada (${body.length} variáveis preservadas).`);

  const dep = await api('POST', `/services/${SERVICE}/deploys`, { clearCache: 'do_not_clear' });
  const id = dep.id;
  console.log('deploy', id, '— as migrations rodam no boot (prisma migrate deploy)');

  process.stdout.write('aguardando');
  for (let i = 0; i < 60; i++) {
    const d = await api('GET', `/services/${SERVICE}/deploys/${id}`);
    const st = d.status || d.deploy?.status;
    if (st === 'live') {
      console.log(' live');
      break;
    }
    if (['build_failed', 'update_failed', 'canceled'].includes(st)) {
      throw new Error('deploy terminou como ' + st);
    }
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 10000));
  }

  // The service answers before Postgres is necessarily reachable, so prove the
  // database actually works rather than trusting a green deploy: registering a
  // user writes, reads and hits a unique index.
  const base = 'https://fisko-api-gxyk.onrender.com/api/v1';
  const health = await (await fetch(base + '/health')).json();
  console.log('health:', JSON.stringify(health));

  const email = `qa.swap.${Date.now().toString(36)}@fisko-test.local`;
  const reg = await fetch(base + '/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'QA Swap', email, password: 'Prueba#2026Fisko' }),
  });
  const out = await reg.json().catch(() => ({}));
  if (reg.status !== 201) {
    throw new Error(`o banco novo não aceitou uma escrita: ${reg.status} ${JSON.stringify(out)}`);
  }
  console.log('escrita no banco novo: ok (usuário de teste criado)');
  await fetch(base + '/auth/me', {
    method: 'DELETE',
    headers: { authorization: 'Bearer ' + out.tokens.accessToken },
  });
  console.log('usuário de teste removido.\n\nPronto.');
}

(async () => {
  try {
    if (flag('show')) return await showState();
    const url = flag('new-render-free') ? await createRenderFree() : arg('url', null);
    if (!url) {
      console.error(
        '\nUso: --url "<connection string>"  |  --new-render-free  |  --show\n',
      );
      process.exit(1);
    }
    await swap(url);
  } catch (err) {
    console.error('\nERRO:', err.message);
    process.exit(1);
  }
})();
