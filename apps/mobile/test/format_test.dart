import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:fisko/core/format.dart';

/// An invoice's date is a day printed on paper, not an instant. The API sends
/// it tagged UTC — midnight for a photographed invoice, SIFEN's offset-less
/// dFeEmiDE for an electronic one — and converting that to the phone's zone
/// moved it. On 2026-09-14 a fuel ticket dated 12/09 showed as 11/09 in
/// Paraguay (UTC-3), while its own key still said 2026-09-12.
///
/// On a machine set to UTC the old code passes these too; they bite in any
/// zone west of Greenwich, which is where every user of this app lives.
void main() {
  setUpAll(() => initializeDateFormatting('es'));

  group('formatDocDate', () {
    test('keeps the printed day of a photographed invoice (midnight UTC)', () {
      expect(formatDocDate(DateTime.utc(2026, 9, 12)), '12/09/2026');
    });

    test('keeps the day of an electronic invoice issued after midnight', () {
      expect(formatDocDate(DateTime.utc(2026, 9, 1, 1, 30)), '01/09/2026');
    });

    test('reads the ISO string the API actually sends', () {
      expect(formatDocDate(DateTime.parse('2026-09-12T00:00:00.000Z')), '12/09/2026');
    });
  });
}
