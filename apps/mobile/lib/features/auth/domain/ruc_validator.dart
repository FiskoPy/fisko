/// Paraguayan RUC check digit (dDVEmi) — mirrors the backend implementation
/// in apps/api/src/utils/ruc.ts (módulo 11, base 11).
///
/// IMPORTANT: validate against real RUCs and the official DNIT spec before
/// relying on this in production.
class RucValidator {
  const RucValidator._();

  static int calcDv(String ruc, {int base = 11}) {
    final digits = ruc.replaceAll(RegExp(r'\D'), '');
    var total = 0;
    var k = 2;
    for (var i = digits.length - 1; i >= 0; i--) {
      total += int.parse(digits[i]) * k;
      k = k < base ? k + 1 : 2;
    }
    final resto = total % 11;
    return resto > 1 ? 11 - resto : 0;
  }

  static String normalize(String ruc) => ruc.replaceAll(RegExp(r'\D'), '');

  static bool isValid(String ruc, int dv) {
    final digits = normalize(ruc);
    if (digits.isEmpty) return false;
    return calcDv(digits) == dv;
  }
}
