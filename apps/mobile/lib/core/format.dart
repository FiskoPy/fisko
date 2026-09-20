import 'package:intl/intl.dart';

/// Shared formatting helpers (amounts + dates), used across features.
final _gs = NumberFormat('#,##0', 'es');
final _money = NumberFormat('#,##0.00', 'es');
final _date = DateFormat('dd/MM/yyyy', 'es');

String formatGs(num value) => 'Gs ${_gs.format(value)}';

final _month = DateFormat('MMM yyyy', 'es');
final _monthLong = DateFormat('MMMM yyyy', 'es');

String _capitalize(String s) => s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);

/// "Ago 2026" — for the month chips.
String formatMonth(DateTime month) => _capitalize(_month.format(month)).replaceAll('.', '');

/// "Agosto 2026" — for the heading of a month's totals.
String formatMonthLong(DateTime month) => _capitalize(_monthLong.format(month));

/// Formats an amount in the currency the invoice was actually issued in.
///
/// Rendering a USD invoice as "Gs 448" made a foreign bill look like a trivial
/// guaraní one — off by roughly four orders of magnitude — and it was then
/// added straight into the guaraní totals.
String formatMoney(num value, String? moneda) {
  final code = (moneda ?? 'PYG').toUpperCase();
  if (code == 'PYG') return formatGs(value);
  return '$code ${_money.format(value)}';
}

/// What a foreign invoice is worth in guaraníes, and at which rate — the
/// figure a month is closed with. Null when the invoice is already in
/// guaraníes, or when no rate was read and it is left out of the totals.
String? formatConverted(num value, String? moneda, num? tipoCambio) {
  if ((moneda ?? 'PYG').toUpperCase() == 'PYG') return null;
  if (tipoCambio == null || tipoCambio <= 0) return null;
  return '≈ ${formatGs(value * tipoCambio)} · cambio ${_money.format(tipoCambio)}';
}

/// An instant — when something happened on the server — in the phone's zone.
String formatDate(DateTime d) => _date.format(d.toLocal());

/// The date printed on a document: a calendar day, not an instant.
///
/// The API stores an invoice's own wall-clock date tagged UTC — midnight for a
/// photographed invoice, and SIFEN's offset-less dFeEmiDE parsed on a UTC
/// server — and groups months in UTC too. Rendering it in the phone's zone
/// moved every photographed invoice to the day before in Paraguay (UTC-3).
String formatDocDate(DateTime d) => _date.format(d.toUtc());
