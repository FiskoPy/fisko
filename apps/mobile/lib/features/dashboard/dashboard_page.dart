import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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
            children: [const SizedBox(height: 160), Center(child: Text('Error: $e'))],
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
