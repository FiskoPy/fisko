import 'dart:convert';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/config/constants.dart';
import '../application/invoices_controller.dart';
import '../data/models/invoice_models.dart';
import 'invoice_format.dart';

/// Captura tab (Marco 2A): import a SIFEN DTE XML and list imported invoices.
class CapturaPage extends ConsumerWidget {
  const CapturaPage({super.key});

  Future<void> _importXml(BuildContext context, WidgetRef ref) async {
    final picked = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['xml'],
      withData: true,
    );
    if (picked == null || picked.files.isEmpty) return;
    final file = picked.files.single;
    String? xml;
    if (file.bytes != null) {
      xml = utf8.decode(file.bytes!, allowMalformed: true);
    }
    if (xml == null || xml.trim().isEmpty) return;
    await ref.read(invoicesControllerProvider.notifier).importXml(xml);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(invoicesControllerProvider);

    ref.listen(invoicesControllerProvider, (prev, next) {
      final messenger = ScaffoldMessenger.of(context);
      if (next.errorMessage != null && next.errorMessage != prev?.errorMessage) {
        messenger.showSnackBar(SnackBar(
          content: Text(next.errorMessage!),
          backgroundColor: Theme.of(context).colorScheme.error,
        ));
        ref.read(invoicesControllerProvider.notifier).clearMessages();
      } else if (next.infoMessage != null && next.infoMessage != prev?.infoMessage) {
        messenger.showSnackBar(SnackBar(content: Text(next.infoMessage!)));
        ref.read(invoicesControllerProvider.notifier).clearMessages();
      }
    });

    return Scaffold(
      appBar: AppBar(title: const Text('Captura')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: state.isImporting ? null : () => _importXml(context, ref),
        icon: state.isImporting
            ? const SizedBox(
                height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
            : const Icon(Icons.upload_file),
        label: const Text('Importar XML'),
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.read(invoicesControllerProvider.notifier).load(),
        child: state.isLoading && state.invoices.isEmpty
            ? const Center(child: CircularProgressIndicator())
            : state.invoices.isEmpty
                ? _EmptyState()
                : ListView.separated(
                    padding: const EdgeInsets.only(bottom: 88, top: 8),
                    itemCount: state.invoices.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (_, i) => _InvoiceTile(invoice: state.invoices[i]),
                  ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return ListView(
      children: [
        const SizedBox(height: 120),
        Icon(Icons.receipt_long_outlined,
            size: 64, color: Theme.of(context).colorScheme.primary),
        const SizedBox(height: 16),
        const Center(child: Text('Sin facturas todavía')),
        const SizedBox(height: 4),
        const Center(child: Text('Tocá "Importar XML" para agregar una factura electrónica.')),
      ],
    );
  }
}

class _InvoiceTile extends StatelessWidget {
  const _InvoiceTile({required this.invoice});

  final Invoice invoice;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: CircleAvatar(
        child: Text(tipoDocLabel(invoice.tipoDoc, invoice.tipoDocDesc).substring(0, 1)),
      ),
      title: Text(invoice.emisorNombre, maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: Text(
        '${tipoDocLabel(invoice.tipoDoc, invoice.tipoDocDesc)} · ${formatDate(invoice.fechaEmision)}',
      ),
      trailing: Text(
        formatGs(invoice.totalOpe),
        style: const TextStyle(fontWeight: FontWeight.bold),
      ),
      onTap: () => context.push('${AppRoutes.captura}/${invoice.id}'),
    );
  }
}
