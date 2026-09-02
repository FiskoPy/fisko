import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/format.dart';
import '../../core/theme/app_theme.dart';
import 'insights_api.dart';

/// "IA Fiscal" block at the top of Inicio: the rule insights and the IVA
/// projection. Quiet by design — it renders nothing while loading or on error,
/// because the dashboard below is the primary content and must not wait on it.
class InsightsSection extends ConsumerWidget {
  const InsightsSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(insightsProvider).valueOrNull;
    if (data == null) return const SizedBox.shrink();
    if (data.insights.isEmpty && data.forecast == null) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final i in data.insights) ...[
          _InsightCard(insight: i),
          const SizedBox(height: 10),
        ],
        if (data.forecast != null) ...[
          _ForecastCard(forecast: data.forecast!),
          const SizedBox(height: 10),
        ],
        const SizedBox(height: 6),
      ],
    );
  }
}

class _InsightCard extends StatelessWidget {
  const _InsightCard({required this.insight});

  final Insight insight;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final fisko = theme.extension<FiskoColors>()!;
    final (icon, tint) = switch (insight.level) {
      'warning' => (Icons.warning_amber_rounded, fisko.iva10),
      'success' => (Icons.check_circle_outline, fisko.iva5),
      _ => (Icons.lightbulb_outline, theme.colorScheme.primary),
    };
    final route = insight.actionRoute;
    final label = insight.actionLabel;

    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(icon, size: 20, color: tint),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    insight.title,
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Padding(
              padding: const EdgeInsets.only(left: 30),
              child: Text(insight.body, style: const TextStyle(fontSize: 13)),
            ),
            if (route != null && label != null)
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  onPressed: () => context.go(route),
                  child: Text(label),
                ),
              )
            else
              const SizedBox(height: 6),
          ],
        ),
      ),
    );
  }
}

class _ForecastCard extends StatelessWidget {
  const _ForecastCard({required this.forecast});

  final IvaForecast forecast;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.auto_graph, size: 20, color: theme.colorScheme.primary),
                const SizedBox(width: 10),
                Text(
                  'Proyección de IVA del mes',
                  style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Padding(
              padding: const EdgeInsets.only(left: 30),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    formatGs(forecast.projected),
                    style: theme.textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                      fontFeatures: AppTheme.tabularFigures,
                    ),
                  ),
                  Text(
                    'Llevás ${formatGs(forecast.soFar)} hasta hoy.',
                    style: TextStyle(fontSize: 12, color: theme.colorScheme.outline),
                  ),
                  if (forecast.comment.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Text(forecast.comment, style: const TextStyle(fontSize: 13)),
                  ],
                  const SizedBox(height: 4),
                  Text(
                    'Estimación. No constituye asesoría fiscal.',
                    style: TextStyle(fontSize: 11, color: theme.colorScheme.outline),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
