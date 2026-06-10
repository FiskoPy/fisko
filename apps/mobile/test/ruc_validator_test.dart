import 'package:flutter_test/flutter_test.dart';
import 'package:fisko/features/auth/domain/ruc_validator.dart';

void main() {
  group('RucValidator', () {
    test('calcDv returns a single digit 0..9', () {
      for (final ruc in ['80012345', '4567891', '12345678']) {
        final dv = RucValidator.calcDv(ruc);
        expect(dv, inInclusiveRange(0, 9));
      }
    });

    test('calcDv ignores separators', () {
      expect(RucValidator.calcDv('800-123-45'), RucValidator.calcDv('80012345'));
    });

    test('isValid accepts the computed dv and rejects a wrong one', () {
      const ruc = '80012345';
      final dv = RucValidator.calcDv(ruc);
      expect(RucValidator.isValid(ruc, dv), isTrue);
      expect(RucValidator.isValid(ruc, (dv + 1) % 10), isFalse);
    });

    test('isValid rejects empty input', () {
      expect(RucValidator.isValid('', 0), isFalse);
    });

    // TODO(produção): adicionar vetores de RUCs reais validados contra a DNIT.
  });
}
