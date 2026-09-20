import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/models/summary_models.dart';
import '../data/reports_api.dart';

/// Loads the fiscal summary for the Dashboard. Re-fetches each time it is read
/// (kept simple; refresh by invalidating the provider).
final fiscalSummaryProvider = FutureProvider<FiscalSummary>((ref) {
  return ref.watch(reportsApiProvider).summary();
});

/// The month the Reports tab is working on: what gets summarised and exported.
/// Null means every month, which is what the dashboard shows.
final reportMonthProvider = StateProvider<DateTime?>((ref) => null);

/// The summary of [reportMonthProvider] — the same numbers the export carries.
final monthSummaryProvider = FutureProvider<FiscalSummary>((ref) {
  final month = ref.watch(reportMonthProvider);
  return ref.watch(reportsApiProvider).summary(month: month);
});
