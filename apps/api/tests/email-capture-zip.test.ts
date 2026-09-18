import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { extractSifenXmls } from '../src/services/email-capture';
import { DTE_XML } from './fixtures/dte';

/**
 * Paraguayan sellers often mail the DTE as a ZIP — "factura.zip" with the XML
 * inside — and the capture, which only looked at loose .xml attachments, found
 * nothing in those mailboxes. The reader walks a ZIP's local headers, so these
 * tests build real archives rather than mocking it.
 */

/** A ZIP of one file, stored or deflated, written by hand. */
function zipOf(name: string, content: string, { stored = false } = {}): Buffer {
  const raw = Buffer.from(content, 'utf8');
  const body = stored ? raw : deflateRawSync(raw);
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0); // local file header
  head.writeUInt16LE(20, 4); // version needed
  head.writeUInt16LE(0, 6); // flags: the sizes are here, not in a descriptor
  head.writeUInt16LE(stored ? 0 : 8, 8); // method: stored or deflate
  head.writeUInt32LE(0, 14); // crc32 — the reader does not check it
  head.writeUInt32LE(body.length, 18);
  head.writeUInt32LE(raw.length, 22);
  head.writeUInt16LE(Buffer.byteLength(name), 26);
  head.writeUInt16LE(0, 28);
  return Buffer.concat([head, Buffer.from(name, 'utf8'), body]);
}

/** One e-mail with one attachment, base64 as a mail server sends it. */
function mailWith(filename: string, mime: string, payload: Buffer): string {
  const b64 = (payload.toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');
  return [
    'From: facturacion@tienda.com.py',
    'To: cliente@example.com',
    'Subject: Factura electronica',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary=BOUND',
    '',
    '--BOUND',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Adjuntamos su factura.',
    '--BOUND',
    `Content-Type: ${mime}; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    'Content-Transfer-Encoding: base64',
    '',
    b64,
    '--BOUND--',
    '',
  ].join('\r\n');
}

describe('a DTE mailed inside a ZIP', () => {
  it('is captured from a deflated archive', async () => {
    const out = await extractSifenXmls(
      mailWith('factura.zip', 'application/zip', zipOf('factura.xml', DTE_XML)),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.xml).toContain('ekuatia.set.gov.py/sifen');
    expect(out[0]?.filename).toMatch(/factura\.zip#1/);
  });

  it('is captured from a stored (uncompressed) archive', async () => {
    const out = await extractSifenXmls(
      mailWith('DE.zip', 'application/zip', zipOf('DE_0011.xml', DTE_XML, { stored: true })),
    );
    expect(out).toHaveLength(1);
  });

  it('is captured when the archive is named .bin but starts with PK', async () => {
    const out = await extractSifenXmls(
      mailWith('adjunto.bin', 'application/octet-stream', zipOf('factura.xml', DTE_XML)),
    );
    expect(out).toHaveLength(1);
  });

  it('ignores an archive that carries no DTE', async () => {
    const out = await extractSifenXmls(
      mailWith('fotos.zip', 'application/zip', zipOf('nota.txt', 'gracias por su compra')),
    );
    expect(out).toEqual([]);
  });

  it('still captures a loose XML attachment', async () => {
    const out = await extractSifenXmls(
      mailWith('factura.xml', 'text/xml', Buffer.from(DTE_XML, 'utf8')),
    );
    expect(out).toHaveLength(1);
  });

  it('does not choke on a truncated archive', async () => {
    const half = zipOf('factura.xml', DTE_XML).subarray(0, 40);
    await expect(
      extractSifenXmls(mailWith('roto.zip', 'application/zip', half)),
    ).resolves.toEqual([]);
  });
});
