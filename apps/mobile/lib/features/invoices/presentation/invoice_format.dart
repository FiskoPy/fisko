export '../../../core/format.dart' show formatGs, formatDate;

/// Maps the SIFEN document type code (iTiDE) to a short Spanish label.
String tipoDocLabel(int tipoDoc, String? fallback) {
  switch (tipoDoc) {
    case 1:
      return 'Factura';
    case 4:
      return 'Autofactura';
    case 5:
      return 'Nota de Crédito';
    case 6:
      return 'Nota de Débito';
    case 7:
      return 'Nota de Remisión';
    default:
      return fallback ?? 'Documento';
  }
}
