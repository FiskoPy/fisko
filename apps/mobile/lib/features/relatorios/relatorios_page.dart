import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

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
      final bytes = await ref.read(reportsApiProvider).export(format);
      final dir = await getTemporaryDirectory();
      final ext = format == 'excel' ? 'xlsx' : 'pdf';
      final file = File('${dir.path}/fisko-reporte.$ext');
      await file.writeAsBytes(bytes);
      await Share.shareXFiles([XFile(file.path)], subject: 'Reporte fiscal Fisko');
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('No se pudo generar el reporte: $e')),
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
