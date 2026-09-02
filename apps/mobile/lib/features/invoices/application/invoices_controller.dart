import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../insights/insights_api.dart';

import '../../../core/errors/failures.dart';
import '../../reports/application/summary_controller.dart';
import '../data/invoices_repository.dart';
import 'invoices_state.dart';

/// Owns the imported-invoices list and the import/delete actions.
class InvoicesController extends Notifier<InvoicesState> {
  InvoicesRepository get _repo => ref.read(invoicesRepositoryProvider);

  @override
  InvoicesState build() {
    Future.microtask(load);
    return const InvoicesState();
  }

  Future<void> load() async {
    state = state.copyWith(isLoading: true, clearMessages: true);
    try {
      final res = await _repo.list(pageSize: 100);
      state = state.copyWith(isLoading: false, invoices: res.items, total: res.total);
    } on Failure catch (f) {
      state = state.copyWith(isLoading: false, errorMessage: f.message);
    }
  }

  /// Imports a DTE XML. Returns true on success.
  Future<bool> importXml(String xml) async {
    state = state.copyWith(isImporting: true, clearMessages: true);
    try {
      await _repo.importXml(xml);
      await load();
      _refreshDashboard();
      state = state.copyWith(isImporting: false, infoMessage: 'Factura importada');
      return true;
    } on Failure catch (f) {
      state = state.copyWith(isImporting: false, errorMessage: f.message);
      return false;
    }
  }

  Future<void> deleteInvoice(String id) async {
    try {
      await _repo.delete(id);
      await load();
      _refreshDashboard();
      state = state.copyWith(infoMessage: 'Factura eliminada');
    } on Failure catch (f) {
      state = state.copyWith(errorMessage: f.message);
    }
  }

  /// The Dashboard/Reports summary is cached, so it must be dropped whenever the
  /// invoice set changes — otherwise "Inicio" keeps showing "Sin datos todavía"
  /// after the first import.
  void _refreshDashboard() {
    ref.invalidate(fiscalSummaryProvider);
    ref.invalidate(insightsProvider);
  }

  void clearMessages() => state = state.copyWith(clearMessages: true);
}

final invoicesControllerProvider = NotifierProvider<InvoicesController, InvoicesState>(
  InvoicesController.new,
);
