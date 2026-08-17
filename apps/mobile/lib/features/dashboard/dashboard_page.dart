import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors/error_message.dart';
import '../../core/format.dart';
import '../../core/theme/app_theme.dart';
import '../reports/application/summary_controller.dart';
import '../reports/data/models/summary_models.dart';

class DashboardPage extends ConsumerWidget {
  const DashboardPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(fiscalSummaryProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Inicio')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(fiscalSummaryProvider),
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ListView(
            children: [
              const SizedBox(height: 160),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: Text(friendlyError(e), textAlign: TextAlign.center),
              ),
            ],
          ),
          data: (s) => s.count == 0 ? _empty() : _Dashboard(summary: s),
        ),
      ),
    );
  }

  Widget _empty() => ListView(
        children: const [
          SizedBox(height: 140),
          Icon(Icons.insights_outlined, size: 64),
          SizedBox(height: 12),
          Center(child: Text('Sin datos todavía')),
          SizedBox(height: 4),
          Center(child: Text('Importá facturas en la pestaña Captura.')),
        ],
      );
}

class _Dashboard extends StatelessWidget {
  const _Dashboard({required this.summary});

  final FiscalSummary summary;

  @override
  Widget build(BuildContext context) {
    final s = summary;
    final fisko = Theme.of(context).extension<FiskoColors>()!;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      children: [
        _IvaComposition(summary: s),
        const SizedBox(height: 16),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 12,
          crossAxisSpacing: 12,
          childAspectRatio: 1.75,
          children: [
            _StatCard(
              label: 'Ventas (ingresos)',
              value: formatGs(s.ventas),
              icon: Icons.north_east,
              tint: fisko.debito,
            ),
            _StatCard(
              label: 'Compras (gastos)',
              value: formatGs(s.compras),
              icon: Icons.south_west,
              tint: fisko.credito,
            ),
            _StatCard(
              label: 'Comprobantes',
              value: '${s.count}',
              icon: Icons.receipt_long,
            ),
            _StatCard(
              label: 'IRP estimado',
              value: formatGs(s.irpEstimado),
              icon: Icons.account_balance,
            ),
          ],
        ),
        if (s.byMonth.isNotEmpty) ...[
          const SizedBox(height: 28),
          Text('Operaciones por mes', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 12),
          SizedBox(height: 200, child: _MonthlyChart(months: s.byMonth)),
        ],
        if (s.byCategory.isNotEmpty) ...[
          const SizedBox(height: 28),
          Text('Por categoría', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 12),
          _CategoryBreakdown(categories: s.byCategory),
        ],
        const SizedBox(height: 20),
        Text(
          'El IRP se estima de forma simplificada. No constituye asesoría fiscal.',
          style: TextStyle(fontSize: 11, color: Theme.of(context).colorScheme.outline),
        ),
      ],
    );
  }
}

/// The screen's anchor: Paraguayan IVA has exactly two rates, so the headline
/// figure is the total and the one thing worth seeing at a glance is how it
/// splits between them. Green is always 5%, amber is always 10% — the same two
/// colours used in every chart and in the PDF/Excel reports.
class _IvaComposition extends StatelessWidget {
  const _IvaComposition({required this.summary});

  final FiscalSummary summary;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final fisko = theme.extension<FiskoColors>()!;
    final s = summary;
    final total = s.iva5 + s.iva10;
    final pct5 = total <= 0 ? 0.0 : s.iva5 / total;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'IVA del período',
              style: TextStyle(fontSize: 12, color: theme.colorScheme.outline),
            ),
            const SizedBox(height: 6),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(
                formatGs(s.totalIva),
                style: theme.textTheme.headlineMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                  letterSpacing: -1,
                  fontFeatures: AppTheme.tabularFigures,
                ),
              ),
            ),
            const SizedBox(height: 16),
            if (total > 0)
              ClipRRect(
                borderRadius: BorderRadius.circular(6),
                child: SizedBox(
                  height: 12,
                  child: Row(
                    children: [
                      if (pct5 > 0)
                        Expanded(
                          flex: (pct5 * 1000).round().clamp(1, 1000),
                          child: ColoredBox(color: fisko.iva5),
                        ),
                      if (pct5 < 1)
                        Expanded(
                          flex: ((1 - pct5) * 1000).round().clamp(1, 1000),
                          child: ColoredBox(color: fisko.iva10),
                        ),
                    ],
                  ),
                ),
              )
            else
              Text(
                'Sin IVA discriminado en las facturas importadas.',
                style: TextStyle(fontSize: 12, color: theme.colorScheme.outline),
              ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: _RateLegend(
                    color: fisko.iva5,
                    label: 'IVA 5%',
                    amount: s.iva5,
                    base: s.baseGrav5,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _RateLegend(
                    color: fisko.iva10,
                    label: 'IVA 10%',
                    amount: s.iva10,
                    base: s.baseGrav10,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _RateLegend extends StatelessWidget {
  const _RateLegend({
    required this.color,
    required this.label,
    required this.amount,
    required this.base,
  });

  final Color color;
  final String label;
  final double amount;
  final double base;

  @override
  Widget build(BuildContext context) {
    final outline = Theme.of(context).colorScheme.outline;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Container(
              height: 8,
              width: 8,
              decoration: BoxDecoration(color: color, shape: BoxShape.circle),
            ),
            const SizedBox(width: 6),
            Text(label, style: TextStyle(fontSize: 12, color: outline)),
          ],
        ),
        const SizedBox(height: 2),
        FittedBox(
          fit: BoxFit.scaleDown,
          alignment: Alignment.centerLeft,
          child: Text(
            formatGs(amount),
            style: const TextStyle(
              fontWeight: FontWeight.w600,
              fontSize: 15,
              fontFeatures: AppTheme.tabularFigures,
            ),
          ),
        ),
        Text(
          'Base ${formatGs(base)}',
          style: TextStyle(fontSize: 11, color: outline),
          overflow: TextOverflow.ellipsis,
        ),
      ],
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({
    required this.label,
    required this.value,
    required this.icon,
    this.tint,
  });

  final String label;
  final String value;
  final IconData icon;
  final Color? tint;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Icon(icon, color: tint ?? scheme.primary, size: 18),
            const Spacer(),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(
                value,
                style: const TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 18,
                  letterSpacing: -0.5,
                  fontFeatures: AppTheme.tabularFigures,
                ),
              ),
            ),
            const SizedBox(height: 2),
            Text(label, style: TextStyle(fontSize: 11, color: scheme.outline)),
          ],
        ),
      ),
    );
  }
}

/// Spending split by expense category, biggest first. Categories are derived
/// server-side by rules today; Marco 2 phase 2E can refine them with AI.
class _CategoryBreakdown extends StatelessWidget {
  const _CategoryBreakdown({required this.categories});

  final List<CategoryBucket> categories;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final fisko = Theme.of(context).extension<FiskoColors>()!;
    final max = categories.fold<double>(0, (m, c) => c.total > m ? c.total : m);

    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        child: Column(
          children: [
            for (final (i, c) in categories.indexed)
              Padding(
                padding: EdgeInsets.only(top: i == 0 ? 0 : 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            '${c.label} · ${c.count}',
                            style: const TextStyle(fontSize: 13),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          formatGs(c.total),
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            fontFeatures: AppTheme.tabularFigures,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(3),
                      child: LinearProgressIndicator(
                        value: max <= 0 ? 0 : (c.total / max).clamp(0.0, 1.0),
                        minHeight: 6,
                        backgroundColor: scheme.surfaceContainerHighest,
                        color: fisko.categoryAt(i),
                      ),
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

class _MonthlyChart extends StatelessWidget {
  const _MonthlyChart({required this.months});

  final List<MonthBucket> months;

  @override
  Widget build(BuildContext context) {
    final data = months.length > 6 ? months.sublist(months.length - 6) : months;
    final maxY = data.fold<double>(0, (m, b) => b.total > m ? b.total : m);
    final scheme = Theme.of(context).colorScheme;

    return BarChart(
      BarChartData(
        maxY: maxY == 0 ? 1 : maxY * 1.2,
        borderData: FlBorderData(show: false),
        gridData: const FlGridData(show: false),
        titlesData: FlTitlesData(
          leftTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          bottomTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              getTitlesWidget: (value, _) {
                final i = value.toInt();
                if (i < 0 || i >= data.length) return const SizedBox.shrink();
                final mm = data[i].month.substring(5); // MM
                return Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(mm, style: const TextStyle(fontSize: 10)),
                );
              },
            ),
          ),
        ),
        barGroups: [
          for (var i = 0; i < data.length; i++)
            BarChartGroupData(x: i, barRods: [
              BarChartRodData(
                toY: data[i].total,
                color: scheme.primary,
                width: 18,
                borderRadius: const BorderRadius.vertical(top: Radius.circular(4)),
              ),
            ]),
        ],
      ),
    );
  }
}
