import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment validation. Fails fast on boot if a required secret is missing.
 * Mirrors the keys documented in ESCOPO.md section 6 / .env.example.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be set (>=16 chars)'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be set (>=16 chars)'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  // Optional in dev — Google sign-in is verified only when configured.
  GOOGLE_CLIENT_ID: z.string().optional(),

  // SMTP optional in dev — when absent, the mailer falls back to an Ethereal test account.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('Fisko <no-reply@fisko.app>'),

  // Preferred for cloud hosting: Brevo HTTP API (port 443) — SMTP from datacenter
  // IPs is often blocked/timed-out. When set, the mailer sends via the Brevo API.
  BREVO_API_KEY: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
