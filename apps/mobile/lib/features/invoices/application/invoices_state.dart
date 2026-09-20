import '../data/models/invoice_models.dart';

class InvoicesState {
  const InvoicesState({
    this.invoices = const [],
    this.total = 0,
    this.period,
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
  final bool isLoading;
  final bool isImporting;
  final String? errorMessage;
  final String? infoMessage;

  InvoicesState copyWith({
    List<Invoice>? invoices,
    int? total,
    DateTime? period,
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
      isLoading: isLoading ?? this.isLoading,
      isImporting: isImporting ?? this.isImporting,
      errorMessage: clearMessages ? null : (errorMessage ?? this.errorMessage),
      infoMessage: clearMessages ? null : (infoMessage ?? this.infoMessage),
    );
  }
}
