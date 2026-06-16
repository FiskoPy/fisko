import '../data/models/invoice_models.dart';

class InvoicesState {
  const InvoicesState({
    this.invoices = const [],
    this.total = 0,
    this.isLoading = false,
    this.isImporting = false,
    this.errorMessage,
    this.infoMessage,
  });

  final List<Invoice> invoices;
  final int total;
  final bool isLoading;
  final bool isImporting;
  final String? errorMessage;
  final String? infoMessage;

  InvoicesState copyWith({
    List<Invoice>? invoices,
    int? total,
    bool? isLoading,
    bool? isImporting,
    String? errorMessage,
    String? infoMessage,
    bool clearMessages = false,
  }) {
    return InvoicesState(
      invoices: invoices ?? this.invoices,
      total: total ?? this.total,
      isLoading: isLoading ?? this.isLoading,
      isImporting: isImporting ?? this.isImporting,
      errorMessage: clearMessages ? null : (errorMessage ?? this.errorMessage),
      infoMessage: clearMessages ? null : (infoMessage ?? this.infoMessage),
    );
  }
}
