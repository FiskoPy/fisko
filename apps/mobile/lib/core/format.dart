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

String formatDate(DateTime d) => _date.format(d.toLocal());
