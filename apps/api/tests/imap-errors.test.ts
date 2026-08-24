import { describe, expect, it } from 'vitest';
import { imapFailureMessage } from '../src/modules/email/email.service';

/**
 * A single "no se pudo iniciar sesión" for every failure cost the client an
 * evening: his host and port were correct and reachable, but the message sent
 * him to re-check those instead of the password.
 */
describe('imapFailureMessage', () => {
  const host = 'mail.tecbio.com.py';
  const port = 993;

  it('names the host and port when the server is unreachable', () => {
    for (const code of ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH']) {
      const msg = imapFailureMessage({ code }, 'imap', host, port);
      expect(msg, code).toContain(`${host}:${port}`);
      expect(msg, code).toMatch(/conectarnos/i);
      expect(msg, code).not.toMatch(/contraseña/i);
    }
  });

  it('calls out TLS problems separately', () => {
    const msg = imapFailureMessage(new Error('self signed certificate'), 'imap', host, port);
    expect(msg).toMatch(/SSL/);
    expect(msg).toContain('993');
  });

  it('blames the credentials only when the server actually answered', () => {
    const msg = imapFailureMessage(
      new Error('Authentication failed'),
      'imap',
      host,
      port,
    );
    expect(msg).toContain(host);
    expect(msg).toMatch(/rechazó/i);
    expect(msg).toMatch(/webmail/i);
    // Points at the other real possibility for corporate Dovecot setups.
    expect(msg).toMatch(/sin @dominio/i);
  });

  it('gives Gmail users the app-password hint instead', () => {
    const msg = imapFailureMessage(
      new Error('Invalid credentials'),
      'gmail',
      'imap.gmail.com',
      993,
    );
    expect(msg).toMatch(/contraseña de aplicación/i);
    expect(msg).toMatch(/16 letras/);
  });

  it('treats an unknown error as a rejection, not as a network fault', () => {
    const msg = imapFailureMessage({}, 'imap', host, port);
    expect(msg).toMatch(/rechazó/i);
  });
});
