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

class _Detail extends ConsumerWidget {
  const _Detail({required this.invoice});

  final Invoice invoice;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final inv = invoice;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(inv.emisorNombre, style: Theme.of(context).textTheme.titleLarge),
        Text('RUC ${inv.emisorRuc}${inv.emisorDv != null ? '-${inv.emisorDv}' : ''}'),
        const SizedBox(height: 8),
        _row('Tipo', tipoDocLabel(inv.tipoDoc, inv.tipoDocDesc)),
        _row('Fecha', formatDocDate(inv.fechaEmision)),
        _CategoriaRow(invoice: inv),
        if (inv.receptorNombre != null) _row('Receptor', inv.receptorNombre!),
        _row('CDC', inv.cdc, mono: true),
        const Divider(height: 24),
        // The paper prints the GROSS amount as "TOTAL GRAVADAS" (IVA
        // included); what the app stores as the base is the NET one, as SIFEN
        // does. Showing only the net under "Base gravada" invited a comparison
        // with the ticket that could never match, so show both, labelled.
        _row('Total gravado 5% (con IVA)', formatMoney(inv.baseGrav5 + inv.iva5, inv.moneda)),
        _row('Base imponible 5% (sin IVA)', formatMoney(inv.baseGrav5, inv.moneda)),
        _row('IVA 5%', formatMoney(inv.iva5, inv.moneda)),
        _row('Total gravado 10% (con IVA)', formatMoney(inv.baseGrav10 + inv.iva10, inv.moneda)),
        _row('Base imponible 10% (sin IVA)', formatMoney(inv.baseGrav10, inv.moneda)),
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
        // In guaraníes, at the rate printed on the invoice: that is the figure
        // this factura carries into the month's IVA.
        if (formatConverted(inv.totalOpe, inv.moneda, inv.tipoCambio) case final converted?)
          Align(
            alignment: Alignment.centerRight,
            child: Text(
              converted,
              style: TextStyle(color: Theme.of(context).colorScheme.outline),
            ),
          )
        else if ((inv.moneda).toUpperCase() != 'PYG')
          Align(
            alignment: Alignment.centerRight,
            child: Text(
              'Sin tipo de cambio: queda fuera de los totales en guaraníes.',
              style: TextStyle(color: Theme.of(context).colorScheme.error, fontSize: 12),
            ),
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

/// What the invoice is filed under — and a way to correct it.
///
/// The rules read the issuer and the items, and cannot know everything: the
/// client's agrochemicals were landing in "Otros". What he corrects stays
/// corrected; what he leaves alone follows the rules, so a better ruleset
/// still reaches it.
class _CategoriaRow extends ConsumerStatefulWidget {
  const _CategoriaRow({required this.invoice});

  final Invoice invoice;

  @override
  ConsumerState<_CategoriaRow> createState() => _CategoriaRowState();
}

class _CategoriaRowState extends ConsumerState<_CategoriaRow> {
  bool _saving = false;

  static const _options = <String, String>{
    'insumos_agricolas': 'Insumos agrícolas',
    'combustible': 'Combustible',
    'supermercado': 'Supermercado y despensa',
    'alimentacion': 'Alimentación',
    'servicios_basicos': 'Servicios básicos',
    'telecomunicaciones': 'Telecomunicaciones',
    'transporte': 'Transporte',
    'salud': 'Salud',
    'educacion': 'Educación',
    'tecnologia': 'Tecnología',
    'financiero': 'Financiero',
    'alquiler': 'Alquiler',
    'vestimenta': 'Vestimenta',
    'otros': 'Otros',
  };

  Future<void> _pick() async {
    final chosen = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            for (final e in _options.entries)
              ListTile(
                title: Text(e.value),
                trailing: e.key == widget.invoice.categoria ? const Icon(Icons.check) : null,
                onTap: () => Navigator.pop(ctx, e.key),
              ),
            if (widget.invoice.categoriaManual)
              ListTile(
                leading: const Icon(Icons.auto_fix_high_outlined),
                title: const Text('Volver a la categoría automática'),
                onTap: () => Navigator.pop(ctx, '__auto__'),
              ),
          ],
        ),
      ),
    );
    if (chosen == null || !mounted) return;

    setState(() => _saving = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref
          .read(invoicesRepositoryProvider)
          .setCategoria(widget.invoice.id, chosen == '__auto__' ? null : chosen);
      ref.invalidate(invoiceDetailProvider(widget.invoice.id));
      ref.read(invoicesControllerProvider.notifier).refreshAfterChange();
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(friendlyError(e))));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final inv = widget.invoice;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          const Text('Categoría'),
          _saving
              ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2))
              : TextButton.icon(
                  onPressed: _pick,
                  icon: const Icon(Icons.edit_outlined, size: 16),
                  label: Text(
                    inv.categoriaLabel + (inv.categoriaManual ? '' : ' (automática)'),
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
