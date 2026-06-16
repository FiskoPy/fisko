import type { EmailConnection } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../errors/app-error';
import { logger } from '../../lib/logger';
import { decryptSecret, encryptSecret, isCryptoConfigured } from '../../services/crypto';
import {
  fetchSifenXmls,
  imapDefaults,
  verifyImapLogin,
  type ImapCredentials,
} from '../../services/email-capture';
import { importXml } from '../invoices/invoices.service';
import type { ConnectEmailInput } from './email.schemas';

export interface PublicEmailConnection {
  id: string;
  provider: string;
  email: string;
  host: string;
  authType: string;
  lastSyncAt: Date | null;
  lastSyncInfo: unknown;
  createdAt: Date;
}

function toPublic(c: EmailConnection): PublicEmailConnection {
  let info: unknown = null;
  if (c.lastSyncInfo) {
    try {
      info = JSON.parse(c.lastSyncInfo);
    } catch {
      info = null;
    }
  }
  return {
    id: c.id,
    provider: c.provider,
    email: c.email,
    host: c.host,
    authType: c.authType,
    lastSyncAt: c.lastSyncAt,
    lastSyncInfo: info,
    createdAt: c.createdAt,
  };
}

function resolveImap(input: ConnectEmailInput): { host: string; port: number; secure: boolean } {
  const defaults = imapDefaults(input.provider);
  const host = input.host ?? defaults?.host;
  const port = input.port ?? defaults?.port ?? 993;
  const secure = input.secure ?? defaults?.secure ?? true;
  if (!host) throw AppError.badRequest('No se pudo determinar el host IMAP');
  return { host, port, secure };
}

function ensureCrypto(): void {
  if (!isCryptoConfigured()) {
    throw AppError.internal(
      'La captura por e-mail no está habilitada en el servidor (falta EMAIL_CRYPTO_KEY)',
    );
  }
}

/** Verifies the mailbox login and stores the (encrypted) connection. */
export async function connectEmail(
  userId: string,
  input: ConnectEmailInput,
): Promise<PublicEmailConnection> {
  ensureCrypto();
  const { host, port, secure } = resolveImap(input);
  const creds: ImapCredentials = { host, port, secure, user: input.email, pass: input.appPassword };

  try {
    await verifyImapLogin(creds);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'email connect: login failed');
    throw AppError.badRequest(
      'No se pudo iniciar sesión en la casilla. Verificá el e-mail y la contraseña de aplicación.',
    );
  }

  const secretEnc = encryptSecret(input.appPassword);

  const conn = await prisma.emailConnection.upsert({
    where: { userId_email: { userId, email: input.email } },
    create: {
      userId,
      provider: input.provider,
      email: input.email,
      host,
      port,
      secure,
      authType: 'app_password',
      secretEnc,
    },
    update: { provider: input.provider, host, port, secure, secretEnc },
  });

  return toPublic(conn);
}

export async function listConnections(userId: string): Promise<PublicEmailConnection[]> {
  const rows = await prisma.emailConnection.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toPublic);
}

export async function disconnectEmail(userId: string, id: string): Promise<void> {
  const res = await prisma.emailConnection.deleteMany({ where: { id, userId } });
  if (res.count === 0) throw AppError.notFound('Conexión no encontrada');
}

export interface SyncResult {
  scanned: number;
  imported: number;
  duplicated: number;
  failed: number;
  errors: string[];
}

/**
 * Scans the connected mailbox, imports every new SIFEN DTE XML found. Existing
 * invoices (same CDC) are counted as duplicated, not errors.
 */
export async function syncEmail(
  userId: string,
  id: string,
  sinceDays?: number,
): Promise<{ connection: PublicEmailConnection; result: SyncResult }> {
  ensureCrypto();
  const conn = await prisma.emailConnection.findFirst({ where: { id, userId } });
  if (!conn) throw AppError.notFound('Conexión no encontrada');

  const creds: ImapCredentials = {
    host: conn.host,
    port: conn.port,
    secure: conn.secure,
    user: conn.email,
    pass: decryptSecret(conn.secretEnc),
  };

  const xmls = await fetchSifenXmls(creds, { sinceDays });
  const result: SyncResult = {
    scanned: xmls.length,
    imported: 0,
    duplicated: 0,
    failed: 0,
    errors: [],
  };

  for (const { filename, xml } of xmls) {
    try {
      await importXml(userId, xml, 'email');
      result.imported += 1;
    } catch (err) {
      if (err instanceof AppError && err.status === 409) {
        result.duplicated += 1;
      } else {
        result.failed += 1;
        if (result.errors.length < 10) {
          result.errors.push(`${filename}: ${(err as Error).message}`);
        }
      }
    }
  }

  const updated = await prisma.emailConnection.update({
    where: { id: conn.id },
    data: { lastSyncInfo: JSON.stringify(result), lastSyncAt: new Date() },
  });

  return { connection: toPublic(updated), result };
}
