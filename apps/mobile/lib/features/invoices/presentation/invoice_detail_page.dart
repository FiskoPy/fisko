import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/errors/error_message.dart';
import '../application/invoices_controller.dart';
import '../data/invoices_repository.dart';
import '../data/models/invoice_models.dart';
import 'invoice_format.dart';

final invoiceDetailProvider = FutureProvider.family<Invoice, String>((ref, id) {
  return ref.watch(invoicesRepositoryProvider).detail(id);
});

class InvoiceDetailPage extends ConsumerWidget {
  const InvoiceDetailPage({required this.id, super.key});

  final String id;

  Future<void> _confirmDelete(BuildContext context, WidgetRef ref) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Eliminar factura'),
        content: const Text('¿Seguro que querés eliminar esta factura?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Eliminar')),
        ],
      ),
    );
    if (ok != true) return;
    await ref.read(invoicesControllerProvider.notifier).deleteInvoice(id);
    if (context.mounted) context.pop();
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(invoiceDetailProvider(id));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Factura'),
        actions: [
          IconButton(
            icon: const Icon(Icons.delete_outline),
            onPressed: () => _confirmDelete(context, ref),
          ),
        ],
      ),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Text(friendlyError(e), textAlign: TextAlign.center),
          ),
        ),
        data: (inv) => _Detail(invoice: inv),
      ),
    );
  }
}

class _Detail extends StatelessWidget {
  const _Detail({required this.invoice});

  final Invoice invoice;

  @override
  Widget build(BuildContext context) {
    final inv = invoice;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(inv.emisorNombre, style: Theme.of(context).textTheme.titleLarge),
        Text('RUC ${inv.emisorRuc}${inv.emisorDv != null ? '-${inv.emisorDv}' : ''}'),
        const SizedBox(height: 8),
        _row('Tipo', tipoDocLabel(inv.tipoDoc, inv.tipoDocDesc)),
        _row('Fecha', formatDate(inv.fechaEmision)),
        if (inv.receptorNombre != null) _row('Receptor', inv.receptorNombre!),
        _row('CDC', inv.cdc, mono: true),
        const Divider(height: 24),
        _row('Base gravada 5%', formatMoney(inv.baseGrav5, inv.moneda)),
        _row('IVA 5%', formatMoney(inv.iva5, inv.moneda)),
        _row('Base gravada 10%', formatMoney(inv.baseGrav10, inv.moneda)),
        _row('IVA 10%', formatMoney(inv.iva10, inv.moneda)),
        _row('Total IVA', formatMoney(inv.totalIva, inv.moneda)),
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text('TOTAL', style: TextStyle(fontWeight: FontWeight.bold)),
            Text(formatMoney(inv.totalOpe, inv.moneda),
                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      color: Theme.of(context).colorScheme.primary,
                      fontWeight: FontWeight.bold,
                    )),
          ],
        ),
        const Divider(height: 24),
        Text('Ítems (${inv.items?.length ?? 0})',
            style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        ...?inv.items?.map((it) => _ItemTile(item: it, moneda: inv.moneda)),
      ],
    );
  }

  Widget _row(String label, String value, {bool mono = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 120, child: Text(label, style: const TextStyle(color: Colors.grey))),
          Expanded(
            child: Text(
              value,
              style: mono ? const TextStyle(fontFamily: 'monospace', fontSize: 12) : null,
            ),
          ),
        ],
      ),
    );
  }
}

class _ItemTile extends StatelessWidget {
  const _ItemTile({required this.item, required this.moneda});

  final InvoiceItem item;

  /// Items are priced in the invoice currency; rendering them as guaraníes
  /// made a USD line look ~7000x cheaper than it is.
  final String moneda;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      dense: true,
      title: Text(item.descripcion, maxLines: 2, overflow: TextOverflow.ellipsis),
      subtitle: Text(
        '${item.cantidad.toStringAsFixed(item.cantidad % 1 == 0 ? 0 : 3)} × '
        '${formatMoney(item.precioUnit, moneda)} · IVA ${item.ivaRate}%',
      ),
      trailing: Text(formatMoney(item.total, moneda)),
    );
  }
}
