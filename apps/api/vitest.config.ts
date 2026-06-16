import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Sensible defaults so unit tests (e.g. RUC) run without a real .env.
    // The auth integration test additionally needs a reachable DATABASE_URL.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgresql://fisko:fisko_dev@localhost:5432/fisko',
      JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? 'test_access_secret_value_0123456789',
      JWT_REFRESH_SECRET:
        process.env.JWT_REFRESH_SECRET ?? 'test_refresh_secret_value_0123456789',
      JWT_ACCESS_TTL: '15m',
      JWT_REFRESH_TTL: '30d',
      EMAIL_CRYPTO_KEY: process.env.EMAIL_CRYPTO_KEY ?? 'test-email-crypto-key-0123456789',
    },
    // Integration tests share a DB — run serially to avoid cross-test races.
    fileParallelism: false,
  },
});
