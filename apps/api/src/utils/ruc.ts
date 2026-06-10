/**
 * Paraguayan RUC check digit (dDVEmi).
 *
 * Reference algorithm from CLAUDE.md section 12 (módulo 11, base 11).
 * IMPORTANT: validate against real RUCs and the official DNIT spec before
 * relying on this in production.
 */
export function calcRucDv(ruc: string, base = 11): number {
  const digits = ruc.replace(/\D/g, '');
  let total = 0;
  let k = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    total += parseInt(digits[i] as string, 10) * k;
    k = k < base ? k + 1 : 2;
  }
  const resto = total % 11;
  return resto > 1 ? 11 - resto : 0;
}

/** Returns the base RUC digits (no separators, no check digit). */
export function normalizeRuc(ruc: string): string {
  return ruc.replace(/\D/g, '');
}

/**
 * Validates that `dv` is the correct check digit for `ruc`.
 * `ruc` should be the base number without the verifier.
 */
export function isValidRucDv(ruc: string, dv: number): boolean {
  const digits = normalizeRuc(ruc);
  if (digits.length === 0) return false;
  return calcRucDv(digits) === dv;
}
