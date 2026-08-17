import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors/error_message.dart';
import '../../core/format.dart';
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
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 12,
          crossAxisSpacing: 12,
          childAspectRatio: 1.7,
          children: [
            _StatCard(label: 'Total operaciones', value: formatGs(s.totalOpe), icon: Icons.summarize),
            _StatCard(label: 'Total IVA', value: formatGs(s.totalIva), icon: Icons.percent),
            _StatCard(label: 'IVA 5%', value: formatGs(s.iva5), icon: Icons.looks_5_outlined),
            _StatCard(label: 'IVA 10%', value: formatGs(s.iva10), icon: Icons.looks_one_outlined),
            _StatCard(label: 'Comprobantes', value: '${s.count}', icon: Icons.receipt_long),
            _StatCard(label: 'IRP estimado', value: formatGs(s.irpEstimado), icon: Icons.account_balance),
          ],
        ),
        const SizedBox(height: 24),
        if (s.byMonth.isNotEmpty) ...[
          Text('Operaciones por mes', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 12),
          SizedBox(height: 200, child: _MonthlyChart(months: s.byMonth)),
        ],
        if (s.byCategory.isNotEmpty) ...[
          const SizedBox(height: 24),
          Text('Por categoría', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 12),
          _CategoryBreakdown(categories: s.byCategory),
        ],
        const SizedBox(height: 16),
        Text(
          'IRP estimado de forma simplificada. No constituye asesoría fiscal.',
          style: TextStyle(fontSize: 11, color: Theme.of(context).colorScheme.outline),
        ),
      ],
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({required this.label, required this.value, required this.icon});

  final String label;
  final String value;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Icon(icon, color: scheme.primary, size: 20),
            const Spacer(),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(value,
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
            ),
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
    final max = categories.fold<double>(0, (m, c) => c.total > m ? c.total : m);

    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Column(
          children: [
            for (final c in categories)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            '${c.label} (${c.count})',
                            style: const TextStyle(fontSize: 13),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          formatGs(c.total),
                          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(3),
                      child: LinearProgressIndicator(
                        value: max <= 0 ? 0 : (c.total / max).clamp(0.0, 1.0),
                        minHeight: 6,
                        backgroundColor: scheme.surfaceContainerHighest,
                        color: scheme.primary,
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
