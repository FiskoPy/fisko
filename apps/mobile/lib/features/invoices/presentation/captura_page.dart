import 'dart:convert';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/config/constants.dart';
import '../../../core/errors/error_message.dart';
import '../application/invoices_controller.dart';
import '../data/invoices_api.dart';
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

  /// Photographs a paper invoice and sends it for OCR.
  ///
  /// The camera compresses to ~1600px: the server caps the upload at 6MB and a
  /// modern phone photo blows past that, while Vision reads a 1600px invoice
  /// just as well as a 4000px one.
  Future<void> _importPhoto(BuildContext context, WidgetRef ref) async {
    // Read from context before the first await: the user can leave the tab
    // while the camera is open, and by then this context is dead.
    final messenger = ScaffoldMessenger.of(context);
    final router = GoRouter.of(context);
    final errorColor = Theme.of(context).colorScheme.error;

    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('Sacar foto'),
              onTap: () => Navigator.pop(ctx, ImageSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Elegir de la galería'),
              onTap: () => Navigator.pop(ctx, ImageSource.gallery),
            ),
          ],
        ),
      ),
    );
    if (source == null) return;

    final picked = await ImagePicker().pickImage(
      source: source,
      maxWidth: 1600,
      imageQuality: 85,
    );
    if (picked == null) return;

    messenger.showSnackBar(
      const SnackBar(content: Text('Leyendo la factura…'), duration: Duration(seconds: 30)),
    );

    try {
      final bytes = await picked.readAsBytes();
      final out = await ref.read(invoicesApiProvider).importPhoto(base64Encode(bytes));
      await ref.read(invoicesControllerProvider.notifier).load();
      messenger.hideCurrentSnackBar();

      // Say what could not be read instead of pretending the record is complete.
      // There is no editing yet, so the honest remedy is: look at it, and if it
      // came out wrong, delete it and shoot the photo again.
      final String msg;
      if (out.missing.isNotEmpty) {
        msg = 'Importada, pero no pudimos leer: ${out.missing.join(", ")}. '
            'Revisala; si quedó mal, borrala y sacá la foto de nuevo.';
      } else if (out.confidence < 0.7) {
        msg = 'Importada, pero la foto se leyó con dificultad. Revisá los montos.';
      } else {
        msg = 'Factura importada.';
      }
      messenger.showSnackBar(SnackBar(
        content: Text(msg),
        duration: const Duration(seconds: 7),
        action: SnackBarAction(
          label: 'Ver',
          onPressed: () => router.push('${AppRoutes.captura}/${out.invoice.id}'),
        ),
      ));
    } catch (e) {
      messenger.hideCurrentSnackBar();
      messenger.showSnackBar(
        SnackBar(
          content: Text(friendlyError(e)),
          backgroundColor: errorColor,
          duration: const Duration(seconds: 6),
        ),
      );
    }
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
      appBar: AppBar(
        title: const Text('Captura'),
        actions: [
          // Paper invoices: photo → Vision OCR → parsed invoice (Marco 2, 2D).
          IconButton(
            icon: const Icon(Icons.photo_camera_outlined),
            tooltip: 'Sacar foto a una factura de papel',
            onPressed: () => _importPhoto(context, ref),
          ),
        ],
      ),
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
        const Center(
          child: Padding(
            padding: EdgeInsets.symmetric(horizontal: 32),
            child: Text(
              'Tocá "Importar XML" para una factura electrónica, o el ícono de '
              'cámara para sacarle una foto a una factura de papel.',
              textAlign: TextAlign.center,
            ),
          ),
        ),
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
        formatMoney(invoice.totalOpe, invoice.moneda),
        style: const TextStyle(fontWeight: FontWeight.bold),
      ),
      onTap: () => context.push('${AppRoutes.captura}/${invoice.id}'),
    );
  }
}
