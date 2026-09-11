#!/usr/bin/env node
/**
 * Turns a Supabase project ref + database password into a DATABASE_URL that
 * actually connects, and proves it by running a query.
 *
 * Why this exists instead of pasting the string from the dashboard:
 *
 *  - The "Connect" screen leads with the DIRECT string
 *    (db.<ref>.supabase.co:5432), which is IPv6-only on new projects. It has
 *    no A record at all, so it cannot be reached from an IPv4-only network —
 *    Render included. Verified: the host does not resolve over IPv4.
 *  - The IPv4 route is the Session pooler, whose host carries a region and a
 *    cluster prefix (aws-0-… or aws-1-…) that differ per project. Both prefixes
 *    resolve, because they are shared endpoints; only a real login says which
 *    one hosts this project (the wrong one answers "Tenant or user not found").
 *  - The session pooler, not the transaction one (6543), because Prisma's
 *    migrate needs a session: the app runs `prisma migrate deploy` on boot.
 *  - The password arrives from a person, and special characters must be
 *    percent-encoded or the URL silently parses to the wrong credentials.
 *
 * Usage (from apps/api):
 *   node scripts/resolve-supabase-url.cjs --ref <ref> --region us-west-2 --password '<pw>'
 * Prints the working URL on success. Nothing is written anywhere.
 */
const { PrismaClient } = require('@prisma/client');

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const ref = arg('ref');
const region = arg('region') || 'us-west-2';
const password = arg('password');

if (!ref || !password) {
  console.error('Uso: --ref <ref> --region <regiao> --password <senha>');
  process.exit(1);
}
if (/\[YOUR-PASSWORD\]/i.test(password)) {
  console.error('Isso é o texto de exemplo, não a senha. Use a senha real do banco.');
  process.exit(1);
}

const pw = encodeURIComponent(password);
const candidates = ['aws-0', 'aws-1'].map(
  (prefix) =>
    `postgresql://postgres.${ref}:${pw}@${prefix}-${region}.pooler.supabase.com:5432/postgres`,
);

const mask = (u) => u.replace(/:([^:@/]+)@/, ':****@');

(async () => {
  for (const url of candidates) {
    const db = new PrismaClient({ datasources: { db: { url } }, log: [] });
    try {
      const rows = await db.$queryRawUnsafe(
        "select current_user as usr, version() as v, inet_server_addr()::text as addr",
      );
      const r = rows[0] || {};
      console.error(`OK   ${mask(url)}`);
      console.error(`     usuario=${r.usr}  ${String(r.v).split(' on ')[0]}`);
      // The URL itself goes to stdout alone, so a caller can capture it.
      console.log(url);
      await db.$disconnect();
      process.exit(0);
    } catch (err) {
      // Prisma leads with "Invalid `prisma.$queryRawUnsafe()` invocation:" and
      // puts the actual cause further down; take the line that names it.
      const lines = String(err.message || err).split('\n').map((l) => l.trim()).filter(Boolean);
      const cause =
        lines.find((l) => /tenant|password|authentication|reach|timeout|refused|fatal|denied|ssl/i.test(l)) ||
        lines[lines.length - 1] ||
        '';
      console.error(`FAIL ${mask(url)}\n     ${cause.slice(0, 180)}`);
      await db.$disconnect().catch(() => {});
    }
  }
  console.error(
    '\nNenhum pooler aceitou. Se a mensagem for "password authentication failed", a senha ' +
      'está errada ou o reset ainda está propagando (pode levar alguns minutos).',
  );
  process.exit(2);
})();
