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

/// An exchange rate as it is written here: "5.921,39".
String formatRate(num rate) => _money.format(rate);

/// "2026-08-30" → "30/08/2026".
String formatIsoDay(String ymd) {
  final p = ymd.split('-');
  return p.length == 3 ? '${p[2]}/${p[1]}/${p[0]}' : ymd;
}

/// A rate typed by hand, the way it is written here or not: "5.921,39",
/// "5921,39", "5.921", "9.436,253", and "5,921.39" or "5921.39" too. With both
/// separators the last one is the decimal point ("9.436,253" as the DNIT
/// prints a pound); a single kind of separator is grouping when three digits
/// follow it and the decimal point otherwise — nobody types a dollar rate to
/// three decimals, and "5,921" is 5.921 guaraníes. "5,921.39" read as 5,92139
/// would put a dollar invoice into the IVA a thousand times too small. Null
/// when it is not a positive number.
double? parseRate(String input) {
  final s = input.replaceAll(RegExp(r'\s'), '');
  if (!RegExp(r'^\d[\d.,]*$').hasMatch(s)) return null;
  final comma = s.lastIndexOf(',');
  final point = s.lastIndexOf('.');
  final last = comma > point ? comma : point;
  final decimalAt = comma >= 0 && point >= 0
      ? last
      : (last >= 0 && !RegExp(r'[.,]\d{3}$').hasMatch(s) ? last : -1);
  final whole = (decimalAt >= 0 ? s.substring(0, decimalAt) : s).replaceAll(RegExp(r'[.,]'), '');
  final v = double.tryParse(decimalAt >= 0 ? '$whole.${s.substring(decimalAt + 1)}' : whole);
  return v != null && v > 0 ? v : null;
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
