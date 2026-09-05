import { describe, expect, it } from 'vitest';

import { loginSchema, registerSchema, resetPasswordSchema } from '../src/modules/auth/auth.schemas';

/**
 * The same visible password can reach us in two different encodings.
 * "Contraseña" is 10 characters either way on screen, but 10 code units in NFC
 * and 11 in NFD (n + U+0303 combining tilde). Android IMEs differ, and a paste
 * from another app can differ from what the same person typed by hand.
 *
 * argon2 compares bytes, so before this the second form was rejected as a wrong
 * password — proven live against the deployed API on 2026-09-05: an account
 * registered with the NFC form answered 401 to the NFD form of the same
 * password. That is a correct password being refused, which is the worst kind
 * of auth bug: the user is told they are wrong when they are right.
 */

const NFC = 'Contraseña#2026'; // ñ as U+00F1
const NFD = 'Contraseña#2026'.normalize('NFD'); // n + U+0303

describe('password Unicode normalisation', () => {
  it('the two forms really are different byte sequences (guards the premise)', () => {
    expect(NFD).not.toBe(NFC);
    expect(NFD.length).toBeGreaterThan(NFC.length);
    expect(NFD.normalize('NFC')).toBe(NFC);
  });

  it('registration stores the composed form whichever way it is typed', () => {
    const a = registerSchema.parse({ name: 'A', email: 'a@b.py', password: NFC });
    const b = registerSchema.parse({ name: 'A', email: 'a@b.py', password: NFD });
    expect(a.password).toBe(b.password);
    expect(b.password).toBe(NFC);
  });

  it('login normalises too — otherwise it would hash a different byte string', () => {
    const a = loginSchema.parse({ email: 'a@b.py', password: NFC });
    const b = loginSchema.parse({ email: 'a@b.py', password: NFD });
    expect(a.password).toBe(b.password);
  });

  it('password reset normalises, so the new password can be typed either way', () => {
    const a = resetPasswordSchema.parse({ token: 'x'.repeat(64), newPassword: NFC });
    const b = resetPasswordSchema.parse({ token: 'x'.repeat(64), newPassword: NFD });
    expect(a.newPassword).toBe(b.newPassword);
  });

  it('counts length after normalising, so an 8-char accented password is accepted', () => {
    // "contraña" is 8 characters; in NFD it is 9 code units and the old rule
    // would have measured 9 — accepting something the user sees as 8.
    const eight = 'contraña'.normalize('NFD');
    expect(eight.length).toBe(9);
    const out = registerSchema.parse({ name: 'A', email: 'a@b.py', password: eight });
    expect(out.password.length).toBe(8);
  });

  it('still rejects a genuinely short password', () => {
    expect(() => registerSchema.parse({ name: 'A', email: 'a@b.py', password: 'añ' }))
      .toThrow(/al menos 8 caracteres/);
  });
});

describe('email is cleaned before it is validated', () => {
  it('accepts a pasted address padded with spaces', () => {
    const out = loginSchema.parse({ email: '  Albertov@TecBio.com.py \n', password: 'x' });
    expect(out.email).toBe('albertov@tecbio.com.py');
  });

  it('still rejects something that is not an address', () => {
    expect(() => loginSchema.parse({ email: 'no es un correo', password: 'x' }))
      .toThrow(/correo/i);
  });
});

describe('validation messages are in Spanish', () => {
  it('names the password rule in Spanish, not Zod English', () => {
    expect(() => registerSchema.parse({ name: 'A', email: 'a@b.py', password: '123' }))
      .toThrow(/La contraseña tiene que tener al menos 8 caracteres/);
  });

  it('names the RUC rule in Spanish', () => {
    expect(() =>
      registerSchema.parse({ name: 'A', email: 'a@b.py', password: 'Prueba12345', ruc: 'ABC' }),
    ).toThrow(/sólo números/);
  });
});
