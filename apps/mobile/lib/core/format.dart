import 'package:intl/intl.dart';

/// Shared formatting helpers (amounts + dates), used across features.
final _gs = NumberFormat('#,##0', 'es');
final _money = NumberFormat('#,##0.00', 'es');
final _date = DateFormat('dd/MM/yyyy', 'es');

String formatGs(num value) => 'Gs ${_gs.format(value)}';

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

/// An instant — when something happened on the server — in the phone's zone.
String formatDate(DateTime d) => _date.format(d.toLocal());

/// The date printed on a document: a calendar day, not an instant.
///
/// The API stores an invoice's own wall-clock date tagged UTC — midnight for a
/// photographed invoice, and SIFEN's offset-less dFeEmiDE parsed on a UTC
/// server — and groups months in UTC too. Rendering it in the phone's zone
/// moved every photographed invoice to the day before in Paraguay (UTC-3).
String formatDocDate(DateTime d) => _date.format(d.toUtc());
