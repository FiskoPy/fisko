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

  // A rate typed by hand, written the way it is here or not: a "." read as a
  // decimal point would make 5.921 guaraníes per dollar 5,921.
  group('parseRate', () {
    test('reads the local way of writing it', () {
      expect(parseRate('5.921,39'), 5921.39);
      expect(parseRate('5921,39'), 5921.39);
      expect(parseRate('5.921'), 5921);
    });

    test('reads the other way too', () {
      expect(parseRate('5921.39'), 5921.39);
      expect(parseRate('5,921.39'), 5921.39);
      expect(parseRate('5,921'), 5921);
      expect(parseRate(' 6030 '), 6030);
      // Currencies quoted in a few guaraníes keep their decimals.
      expect(parseRate('3,91'), 3.91);
      // Three decimals, as the DNIT printed a pound: both separators.
      expect(parseRate('9.436,253'), 9436.253);
    });

    test('is nothing when it is not a positive number', () {
      expect(parseRate(''), isNull);
      expect(parseRate('abc'), isNull);
      expect(parseRate('0'), isNull);
    });
  });

  test('formatIsoDay writes the day the way it is read here', () {
    expect(formatIsoDay('2026-08-30'), '30/08/2026');
  });
}
