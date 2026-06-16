import 'package:freezed_annotation/freezed_annotation.dart';

part 'invoice_models.freezed.dart';
part 'invoice_models.g.dart';

@freezed
class InvoiceItem with _$InvoiceItem {
  const factory InvoiceItem({
    required String id,
    String? codigo,
    required String descripcion,
    required double cantidad,
    required double precioUnit,
    required double total,
    required int ivaRate,
    required double ivaBase,
    required double ivaMonto,
  }) = _InvoiceItem;

  factory InvoiceItem.fromJson(Map<String, dynamic> json) => _$InvoiceItemFromJson(json);
}

@freezed
class Invoice with _$Invoice {
  const factory Invoice({
    required String id,
    required String cdc,
    required int tipoDoc,
    String? tipoDocDesc,
    required String emisorRuc,
    int? emisorDv,
    required String emisorNombre,
    String? receptorRuc,
    String? receptorNombre,
    required DateTime fechaEmision,
    @Default('PYG') String moneda,
    required double totalOpe,
    required double totalIva,
    required double iva5,
    required double iva10,
    required double baseGrav5,
    required double baseGrav10,
    String? originalCdc,
    @Default('manual') String source,
    DateTime? createdAt,
    List<InvoiceItem>? items,
  }) = _Invoice;

  factory Invoice.fromJson(Map<String, dynamic> json) => _$InvoiceFromJson(json);
}

@freezed
class InvoiceList with _$InvoiceList {
  const factory InvoiceList({
    required List<Invoice> items,
    required int total,
    required int page,
    required int pageSize,
  }) = _InvoiceList;

  factory InvoiceList.fromJson(Map<String, dynamic> json) => _$InvoiceListFromJson(json);
}
