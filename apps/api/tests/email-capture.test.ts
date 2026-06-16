import { describe, it, expect } from 'vitest';
import { extractSifenXmls, imapDefaults } from '../src/services/email-capture';
import { encryptSecret, decryptSecret, isCryptoConfigured } from '../src/services/crypto';
import { DTE_XML, REAL_CDC } from './fixtures/dte';

/** Builds a raw RFC822 e-mail with the given attachment. */
function buildEmail(attachment: { filename: string; contentType: string; body: string }): string {
  const b64 = Buffer.from(attachment.body, 'utf8').toString('base64');
  const wrapped = b64.match(/.{1,76}/g)?.join('\r\n') ?? b64;
  return [
    'From: SET <facturas@set.gov.py>',
    'To: contribuyente@gmail.com',
    'Subject: Factura electronica',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="BND"',
    '',
    '--BND',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Adjuntamos su Documento Tributario Electronico.',
    '--BND',
    `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
    `Content-Disposition: attachment; filename="${attachment.filename}"`,
    'Content-Transfer-Encoding: base64',
    '',
    wrapped,
    '--BND--',
    '',
  ].join('\r\n');
}

describe('email-capture: extractSifenXmls', () => {
  it('extracts a SIFEN DTE XML attachment', async () => {
    const raw = buildEmail({
      filename: 'factura.xml',
      contentType: 'application/xml',
      body: DTE_XML,
    });
    const found = await extractSifenXmls(raw);
    expect(found).toHaveLength(1);
    expect(found[0]!.filename).toBe('factura.xml');
    expect(found[0]!.xml).toContain(REAL_CDC);
  });

  it('ignores XML attachments that are not SIFEN DTE', async () => {
    const raw = buildEmail({
      filename: 'reporte.xml',
      contentType: 'application/xml',
      body: '<?xml version="1.0"?><root><hello/></root>',
    });
    const found = await extractSifenXmls(raw);
    expect(found).toHaveLength(0);
  });

  it('ignores non-XML attachments (e.g. PDF)', async () => {
    const raw = buildEmail({
      filename: 'recibo.pdf',
      contentType: 'application/pdf',
      body: '%PDF-1.4 fake pdf bytes',
    });
    const found = await extractSifenXmls(raw);
    expect(found).toHaveLength(0);
  });
});

describe('email-capture: imapDefaults', () => {
  it('resolves Gmail and Outlook hosts', () => {
    expect(imapDefaults('gmail')).toEqual({ host: 'imap.gmail.com', port: 993, secure: true });
    expect(imapDefaults('outlook')).toEqual({
      host: 'outlook.office365.com',
      port: 993,
      secure: true,
    });
    expect(imapDefaults('imap')).toBeNull();
  });
});

describe('crypto: secret round-trip', () => {
  it('encrypts and decrypts back to the original', () => {
    expect(isCryptoConfigured()).toBe(true);
    const secret = 'abcd efgh ijkl mnop'; // gmail app password shape
    const enc = encryptSecret(secret);
    expect(enc).not.toContain(secret);
    expect(enc.split('.')).toHaveLength(3);
    expect(decryptSecret(enc)).toBe(secret);
  });
});
