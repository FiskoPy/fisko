import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/errors/error_message.dart';
import '../../core/format.dart';
import '../reports/application/summary_controller.dart';
import '../reports/data/models/summary_models.dart';
import '../reports/data/reports_api.dart';

class RelatoriosPage extends ConsumerStatefulWidget {
  const RelatoriosPage({super.key});

  @override
  ConsumerState<RelatoriosPage> createState() => _RelatoriosPageState();
}

class _RelatoriosPageState extends ConsumerState<RelatoriosPage> {
  String? _busy; // 'pdf' | 'excel' | null

  Future<void> _generate(String format) async {
    setState(() => _busy = format);
    try {
      final month = ref.read(reportMonthProvider);
      final bytes = await ref.read(reportsApiProvider).export(format, month: month);
      final dir = await getTemporaryDirectory();
      final ext = format == 'excel' ? 'xlsx' : 'pdf';
      // The accountant gets one file per month; the name has to say which.
      final tag = month == null
          ? 'todo'
          : '${month.year}-${month.month.toString().padLeft(2, '0')}';
      final file = File('${dir.path}/fisko-reporte-$tag.$ext');
      await file.writeAsBytes(bytes);
      await Share.shareXFiles([XFile(file.path)], subject: 'Reporte fiscal Fisko');
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('No se pudo generar el reporte. ${friendlyError(e)}')),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Reportes')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const SizedBox(height: 8),
          Text(
            'Generá un reporte fiscal con el IVA discriminado (5% y 10%) y la estimación de IRP, '
            'a partir de las facturas importadas. Podés compartirlo (incl. por WhatsApp).',
            style: TextStyle(color: Theme.of(context).colorScheme.outline),
          ),
          const SizedBox(height: 16),
          // The IVA is declared month by month, so the report is asked for a
          // month. The client closed August in September and had no way to
          // tell the two apart.
          const _MonthPicker(),
          const SizedBox(height: 16),
          const _MonthTotals(),
          const SizedBox(height: 24),
          _ReportButton(
            label: 'Generar PDF',
            icon: Icons.picture_as_pdf,
            busy: _busy == 'pdf',
            enabled: _busy == null,
            onTap: () => _generate('pdf'),
          ),
          const SizedBox(height: 12),
          _ReportButton(
            label: 'Generar Excel',
            icon: Icons.grid_on,
            busy: _busy == 'excel',
            enabled: _busy == null,
            onTap: () => _generate('excel'),
          ),
        ],
      ),
    );
  }
}

/// Which month the report covers. The months offered are the ones that have
/// invoices, newest first, plus the current one.
class _MonthPicker extends ConsumerWidget {
  const _MonthPicker();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selected = ref.watch(reportMonthProvider);
    final summary = ref.watch(fiscalSummaryProvider).valueOrNull;
    final now = DateTime.now();
    final months = <DateTime>{DateTime.utc(now.year, now.month)};
    for (final b in summary?.byMonth ?? const <MonthBucket>[]) {
      final parts = b.month.split('-');
      if (parts.length >= 2) {
        final y = int.tryParse(parts[0]);
        final m = int.tryParse(parts[1]);
        if (y != null && m != null) months.add(DateTime.utc(y, m));
      }
    }
    final ordered = months.toList()..sort((a, b) => b.compareTo(a));

    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final m in ordered)
          ChoiceChip(
            label: Text(formatMonth(m)),
            selected: selected != null && selected.year == m.year && selected.month == m.month,
            onSelected: (_) => ref.read(reportMonthProvider.notifier).state = m,
          ),
        ChoiceChip(
          label: const Text('Todos'),
          selected: selected == null,
          onSelected: (_) => ref.read(reportMonthProvider.notifier).state = null,
        ),
      ],
    );
  }
}

/// What that month adds up to — the same figures the file will carry.
class _MonthTotals extends ConsumerWidget {
  const _MonthTotals();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final month = ref.watch(reportMonthProvider);
    final scheme = Theme.of(context).colorScheme;
    return ref.watch(monthSummaryProvider).when(
          loading: () => const LinearProgressIndicator(),
          error: (_, __) => const SizedBox.shrink(),
          data: (s) => Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: scheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  month == null ? 'Todos los meses' : formatMonthLong(month),
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 6),
                Text(
                  '${s.count} comprobante(s) computables'
                  '${s.sinOperacion > 0 ? " - ${s.sinOperacion} nota(s) de remisión" : ""}'
                  ' - compras ${formatGs(s.compras)}',
                ),
                const SizedBox(height: 10),
                // The liquidation, in the order it is declared. A credit
                // balance is not something owed: it carries to the next period.
                _StatementRow(label: 'IVA crédito (compras)', value: s.ivaCredito),
                _StatementRow(label: 'IVA débito (ventas)', value: s.ivaDebito),
                _StatementRow(label: 'Saldo a favor anterior', value: s.saldoAnterior),
                _StatementRow(label: 'IVA a pagar', value: s.ivaAPagar, bold: true),
                _StatementRow(
                  label: 'Saldo a favor al período siguiente',
                  value: s.saldoSiguiente,
                  bold: true,
                ),
                const SizedBox(height: 6),
                // The income tax is annual: the year so far, without IVA.
                Text(
                  s.rentaDesde != null && s.rentaHasta != null
                      ? '${s.rentaRegimen} estimado del ejercicio ${formatGs(s.rentaEstimado)} '
                          '(10% de ventas ${formatGs(s.rentaIngresos)} menos compras '
                          '${formatGs(s.rentaEgresos)}, sin IVA, del ${formatIsoDay(s.rentaDesde!)} '
                          'al ${formatIsoDay(s.rentaHasta!)})'
                      : '${s.rentaRegimen} estimado ${formatGs(s.rentaEstimado)}',
                  style: TextStyle(color: scheme.outline),
                ),
                if (s.sinConversion > 0)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(
                      '${s.sinConversion} en moneda extranjera sin tipo de cambio quedaron fuera.',
                      style: TextStyle(color: scheme.error, fontSize: 12),
                    ),
                  ),
              ],
            ),
          ),
        );
  }
}

/// One line of the IVA liquidation.
class _StatementRow extends StatelessWidget {
  const _StatementRow({required this.label, required this.value, this.bold = false});

  final String label;
  final double value;
  final bool bold;

  @override
  Widget build(BuildContext context) {
    final style = TextStyle(fontWeight: bold ? FontWeight.bold : FontWeight.normal);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: style),
          Text(formatGs(value), style: style),
        ],
      ),
    );
  }
}

class _ReportButton extends StatelessWidget {
  const _ReportButton({
    required this.label,
    required this.icon,
    required this.busy,
    required this.enabled,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final bool busy;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return FilledButton.icon(
      onPressed: enabled ? onTap : null,
      icon: busy
          ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
          : Icon(icon),
      label: Text(label),
    );
  }
}
