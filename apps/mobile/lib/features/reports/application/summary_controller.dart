import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/models/summary_models.dart';
import '../data/reports_api.dart';

/// Loads the fiscal summary for the Dashboard. Re-fetches each time it is read
/// (kept simple; refresh by invalidating the provider).
final fiscalSummaryProvider = FutureProvider<FiscalSummary>((ref) {
  return ref.watch(reportsApiProvider).summary();
});
