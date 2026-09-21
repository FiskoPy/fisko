import '../data/models/invoice_models.dart';

class InvoicesState {
  const InvoicesState({
    this.invoices = const [],
    this.total = 0,
    this.period,
    this.tipo,
    this.isLoading = false,
    this.isImporting = false,
    this.errorMessage,
    this.infoMessage,
  });

  final List<Invoice> invoices;
  final int total;

  /// The month being shown, as its first day (UTC), or null for every month.
  /// A closing is by month, and the list used to mix them.
  final DateTime? period;

  /// 'venta', 'compra', or null for both. The IVA of a sale is debito and the
  /// IVA of a purchase is credito; they are never one figure.
  final String? tipo;
  final bool isLoading;
  final bool isImporting;
  final String? errorMessage;
  final String? infoMessage;

  InvoicesState copyWith({
    List<Invoice>? invoices,
    int? total,
    DateTime? period,
    String? tipo,
    bool allTipos = false,
    bool allMonths = false,
    bool? isLoading,
    bool? isImporting,
    String? errorMessage,
    String? infoMessage,
    bool clearMessages = false,
  }) {
    return InvoicesState(
      invoices: invoices ?? this.invoices,
      total: total ?? this.total,
      period: allMonths ? null : (period ?? this.period),
      tipo: allTipos ? null : (tipo ?? this.tipo),
      isLoading: isLoading ?? this.isLoading,
      isImporting: isImporting ?? this.isImporting,
      errorMessage: clearMessages ? null : (errorMessage ?? this.errorMessage),
      infoMessage: clearMessages ? null : (infoMessage ?? this.infoMessage),
    );
  }
}
