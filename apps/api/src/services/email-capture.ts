import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { logger } from '../lib/logger';

/**
 * Automatic invoice capture from an e-mail mailbox via IMAP.
 *
 * Homologation-friendly: works today with a Gmail "app password" (2FA enabled)
 * — no Google Cloud OAuth project required. The same code reaches any IMAP host.
 * Microsoft personal accounts disabled basic-auth IMAP, so Outlook needs the
 * OAuth/Graph path (added later, blocked on the client's Azure app).
 *
 * The network layer (fetchSifenXmls) is kept thin; the parsing core
 * (extractSifenXmls) is a pure async function so it can be unit-tested with a
 * fixture e-mail, with no live server.
 */

export interface ImapCredentials {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

export interface CapturedXml {
  filename: string;
  xml: string;
}

const SIFEN_NS = 'ekuatia.set.gov.py/sifen';

/** True when an attachment looks like a SIFEN DTE XML (by name + namespace). */
function looksLikeSifenXml(filename: string | undefined, content: string): boolean {
  const isXmlName = (filename ?? '').toLowerCase().endsWith('.xml');
  const looksXml = isXmlName || content.trimStart().startsWith('<?xml') || content.includes('<rDE');
  return looksXml && content.includes(SIFEN_NS);
}

/**
 * Parses a raw RFC822 e-mail and returns every attachment that is a SIFEN DTE
 * XML. Pure (no network) — testable with a fixture message.
 */
export async function extractSifenXmls(rawSource: Buffer | string): Promise<CapturedXml[]> {
  const parsed = await simpleParser(rawSource);
  const out: CapturedXml[] = [];

  for (const att of parsed.attachments ?? []) {
    const content = att.content?.toString('utf8') ?? '';
    if (looksLikeSifenXml(att.filename, content)) {
      out.push({ filename: att.filename ?? 'factura.xml', xml: content });
    }
  }
  return out;
}

export interface FetchOptions {
  /** Only scan messages received within the last N days (default 30). */
  sinceDays?: number;
  /** Mailbox to scan (default INBOX). */
  mailbox?: string;
  /** Hard cap on messages scanned per sync (default 200). */
  maxMessages?: number;
}

/**
 * Connects to the mailbox over IMAP, scans recent messages and returns every
 * SIFEN DTE XML found in attachments. Verifies the credentials by logging in.
 */
export async function fetchSifenXmls(
  creds: ImapCredentials,
  opts: FetchOptions = {},
): Promise<CapturedXml[]> {
  const sinceDays = opts.sinceDays ?? 30;
  const mailbox = opts.mailbox ?? 'INBOX';
  const maxMessages = opts.maxMessages ?? 200;

  const client = new ImapFlow({
    host: creds.host,
    port: creds.port,
    secure: creds.secure,
    auth: { user: creds.user, pass: creds.pass },
    logger: false,
  });

  const found: CapturedXml[] = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
      const uids = (await client.search({ since }, { uid: true })) || [];
      const slice = uids.slice(-maxMessages);

      for (const uid of slice) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        const xmls = await extractSifenXmls(msg.source);
        found.push(...xmls);
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }

  logger.info({ count: found.length, mailbox }, 'email-capture: scanned mailbox');
  return found;
}

/** Verifies IMAP credentials by connecting and logging out. Throws on failure. */
export async function verifyImapLogin(creds: ImapCredentials): Promise<void> {
  const client = new ImapFlow({
    host: creds.host,
    port: creds.port,
    secure: creds.secure,
    auth: { user: creds.user, pass: creds.pass },
    logger: false,
  });
  await client.connect();
  await client.logout().catch(() => undefined);
}

/** Known IMAP defaults per provider. */
export function imapDefaults(provider: string): { host: string; port: number; secure: boolean } | null {
  switch (provider) {
    case 'gmail':
      return { host: 'imap.gmail.com', port: 993, secure: true };
    case 'outlook':
      return { host: 'outlook.office365.com', port: 993, secure: true };
    default:
      return null;
  }
}
