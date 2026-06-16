import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';
import { env } from '../config/env';
import { AppError } from '../errors/app-error';

/**
 * Symmetric encryption for secrets stored at rest (e.g. IMAP app passwords).
 * AES-256-GCM with a per-value random IV. The 32-byte key is derived from
 * EMAIL_CRYPTO_KEY via scrypt, so the env var can be any sufficiently long
 * passphrase. Output format: base64(iv).base64(authTag).base64(ciphertext).
 */
const SALT = 'fisko.email.v1';

function key(): Buffer {
  if (!env.EMAIL_CRYPTO_KEY) {
    throw AppError.internal('EMAIL_CRYPTO_KEY no está configurado en el servidor');
  }
  return scryptSync(env.EMAIL_CRYPTO_KEY, SALT, 32);
}

export function isCryptoConfigured(): boolean {
  return Boolean(env.EMAIL_CRYPTO_KEY);
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw AppError.internal('Secreto cifrado con formato inválido');
  }
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
