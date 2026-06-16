import 'package:freezed_annotation/freezed_annotation.dart';

part 'summary_models.freezed.dart';
part 'summary_models.g.dart';

@freezed
class MonthBucket with _$MonthBucket {
  const factory MonthBucket({
    required String month,
    required int count,
    required double total,
    required double iva,
  }) = _MonthBucket;

  factory MonthBucket.fromJson(Map<String, dynamic> json) => _$MonthBucketFromJson(json);
}

@freezed
class FiscalSummary with _$FiscalSummary {
  const factory FiscalSummary({
    @Default(0) int count,
    @Default(0) double totalOpe,
    @Default(0) double totalIva,
    @Default(0) double iva5,
    @Default(0) double iva10,
    @Default(0) double baseGrav5,
    @Default(0) double baseGrav10,
    @Default(0) double ventas,
    @Default(0) double compras,
    @Default(0) double ivaCredito,
    @Default(0) double ivaDebito,
    @Default(0) double irpEstimado,
    @Default([]) List<MonthBucket> byMonth,
  }) = _FiscalSummary;

  factory FiscalSummary.fromJson(Map<String, dynamic> json) => _$FiscalSummaryFromJson(json);
}
