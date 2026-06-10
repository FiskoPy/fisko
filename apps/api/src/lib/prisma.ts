import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';

/**
 * Single PrismaClient instance reused across the process. In development with
 * watch/reload we cache it on globalThis to avoid exhausting DB connections.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
