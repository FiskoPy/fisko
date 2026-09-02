import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/dio_client.dart';

/// One rule-based fiscal insight from GET /insights (Marco 2, 2E).
class Insight {
  Insight({
    required this.kind,
    required this.level,
    required this.title,
    required this.body,
    this.actionLabel,
    this.actionRoute,
  });

  final String kind;

  /// info | warning | success
  final String level;
  final String title;
  final String body;
  final String? actionLabel;
  final String? actionRoute;

  factory Insight.fromJson(Map<String, dynamic> j) {
    final a = j['action'] as Map<String, dynamic>?;
    return Insight(
      kind: (j['kind'] as String?) ?? '',
      level: (j['level'] as String?) ?? 'info',
      title: (j['title'] as String?) ?? '',
      body: (j['body'] as String?) ?? '',
      actionLabel: a?['label'] as String?,
      actionRoute: a?['route'] as String?,
    );
  }
}

/// The IVA projection for the current month.
class IvaForecast {
  IvaForecast({
    required this.projected,
    required this.soFar,
    required this.comment,
    required this.fromModel,
  });

  final double projected;
  final double soFar;
  final String comment;
  final bool fromModel;

  factory IvaForecast.fromJson(Map<String, dynamic> j) => IvaForecast(
        projected: ((j['projected'] as num?) ?? 0).toDouble(),
        soFar: ((j['soFar'] as num?) ?? 0).toDouble(),
        comment: (j['comment'] as String?) ?? '',
        fromModel: (j['fromModel'] as bool?) ?? false,
      );
}

class InsightsBundle {
  InsightsBundle({required this.insights, required this.forecast});

  final List<Insight> insights;
  final IvaForecast? forecast;
}

class InsightsApi {
  InsightsApi(this._dio);

  final Dio _dio;

  Future<InsightsBundle> fetch() async {
    final res = await _dio.get<Map<String, dynamic>>('/insights');
    final d = res.data!;
    return InsightsBundle(
      insights: ((d['insights'] as List?) ?? const [])
          .map((e) => Insight.fromJson(e as Map<String, dynamic>))
          .toList(),
      forecast: d['forecast'] is Map<String, dynamic>
          ? IvaForecast.fromJson(d['forecast'] as Map<String, dynamic>)
          : null,
    );
  }
}

final insightsApiProvider =
    Provider<InsightsApi>((ref) => InsightsApi(ref.watch(dioProvider)));

/// Computed on request by the server, so it must be re-read whenever the
/// invoice set changes — invalidated alongside fiscalSummaryProvider.
final insightsProvider = FutureProvider.autoDispose<InsightsBundle>(
  (ref) => ref.watch(insightsApiProvider).fetch(),
);
