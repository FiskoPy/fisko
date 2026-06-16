import 'package:intl/intl.dart';

/// Shared formatting helpers (Guaraní amounts + dates), used across features.
final _gs = NumberFormat('#,##0', 'es');
final _date = DateFormat('dd/MM/yyyy', 'es');

String formatGs(num value) => 'Gs ${_gs.format(value)}';
String formatDate(DateTime d) => _date.format(d.toLocal());
